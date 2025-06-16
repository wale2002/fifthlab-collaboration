const jwt = require("jsonwebtoken");
const { promisify } = require("util");
const User = require("../models/userModel");
const Email = require("../utils/email");
const crypto = require("crypto");

const validator = require("validator");
const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, req, res) => {
  const token = signToken(user._id);

  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  };

  res.cookie("jwt", token, cookieOptions);
  user.password = undefined;

  res.status(statusCode).json({
    success: true, // Align with frontend expectations
    token,
    data: { user },
  });
};

exports.signup = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      accountName,
      password,
      teamMemberEmail,
      teamMemberRole,
      isOAuth = false, // Added for Google OAuth
    } = req.body;

    // 1. Validate required fields for main user
    if (!firstName || !lastName || !email || (!password && !isOAuth)) {
      return res.status(400).json({
        status: "fail",
        message: "Missing required fields",
      });
    }

    // 2. Validate emails
    if (!validator.isEmail(email)) {
      return res.status(400).json({ status: "fail", message: "Invalid email" });
    }
    if (teamMemberEmail && !validator.isEmail(teamMemberEmail)) {
      return res
        .status(400)
        .json({ status: "fail", message: "Invalid team member email" });
    }

    // 3. Check for existing main user email and accountName
    const existingUser = await User.findOne({
      $or: [{ email }, { accountName }],
    });
    if (existingUser) {
      return res.status(400).json({
        status: "fail",
        message:
          existingUser.email === email
            ? "Email already in use"
            : "Account name already taken",
      });
    }

    // 4. Check for existing team member email
    if (teamMemberEmail) {
      const existingTeamMember = await User.findOne({ email: teamMemberEmail });
      if (existingTeamMember) {
        return res.status(400).json({
          status: "fail",
          message: "Team member email already in use",
        });
      }
    }

    // 5. Create the main user
    const newUser = await User.create({
      firstName,
      lastName,
      email,
      accountName,
      password: isOAuth ? undefined : password, // No password for OAuth users
      role: "Viewer",
      isInvited: false,
      isOAuth,
    });

    // 6. Send welcome email to main user (skip for OAuth users)
    if (!isOAuth) {
      const loginUrl = `${req.protocol}://${req.get("host")}/login`;
      try {
        await new Email(newUser, loginUrl).sendWelcome();
      } catch (emailErr) {
        console.error("Failed to send welcome email:", emailErr);
      }
    }

    // 7. Create the team member if provided
    if (teamMemberEmail) {
      const tempPassword = crypto.randomBytes(8).toString("hex");

      const teamMember = await User.create({
        firstName: "Team",
        lastName: "Member",
        email: teamMemberEmail,
        accountName,
        password: tempPassword,
        role: teamMemberRole || "Viewer",
        isInvited: true,
      });

      const loginUrl = `${req.protocol}://${req.get("host")}/login`;
      try {
        await new Email(
          teamMember,
          loginUrl,
          tempPassword
        ).sendTemporaryPassword();
      } catch (emailErr) {
        console.error("Failed to send team member email:", emailErr);
      }
    }

    // 8. Send success response with token
    createSendToken(newUser, 201, req, res);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        status: "fail",
        message: "Email or account name already in use",
      });
    }
    console.error("Signup error:", err);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ status: "fail", message: "Provide email and password" });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.correctPassword(password, user.password))) {
      return res
        .status(401)
        .json({ status: "fail", message: "Incorrect email or password" });
    }

    createSendToken(user, 200, req, res);
  } catch (err) {
    res.status(500).json({ status: "error", message: "Login failed" });
  }
};

exports.logout = (req, res) => {
  const username = req.user?.firstName || req.user?.email || "User";
  res.cookie("jwt", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  res.status(200).json({
    status: "success",
    message: `${username} logged out successfully`,
    timestamp: new Date().toISOString(),
  });
};

exports.protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      return res.status(401).json({ status: "fail", message: "Not logged in" });
    }

    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    const currentUser = await User.findById(decoded.id);

    if (!currentUser) {
      return res
        .status(401)
        .json({ status: "fail", message: "User no longer exists" });
    }

    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return res
        .status(401)
        .json({ status: "fail", message: "Password recently changed" });
    }

    req.user = currentUser;
    res.locals.user = currentUser;
    next();
  } catch (err) {
    return res.status(401).json({
      status: "fail",
      message: "Invalid or expired token",
      error: err.message,
    });
  }
};

exports.isLoggedIn = async (req, res, next) => {
  try {
    if (!req.cookies?.jwt) return next();

    const decoded = await promisify(jwt.verify)(
      req.cookies.jwt,
      process.env.JWT_SECRET
    );
    const currentUser = await User.findById(decoded.id);

    if (!currentUser || currentUser.changedPasswordAfter(decoded.iat)) {
      return next();
    }

    req.user = currentUser;
    res.locals.user = currentUser;
  } catch (err) {
    // Silently fail
  }
  next();
};

// Rate limiter middleware

exports.forgotPassword = async (req, res, next) => {
  try {
    // 1. Find user by email
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return res.status(404).json({ message: "No user found with that email" });
    }

    // 2. Generate reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // 3. Create reset URL
    const resetURL = `${req.protocol}://${req.get(
      "host"
    )}/api/resetPassword/${resetToken}`;

    // 4. Send password reset email using Email class
    await new Email(user, resetURL).sendPasswordReset();

    // 5. Send response
    res.status(200).json({
      status: "success",
      message: "Token sent to email!",
      resetToken,
    });
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    // Clear reset token if email fails
    if (user) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
    }
    res
      .status(500)
      .json({ message: "Failed to send email", error: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    // Log incoming request details for debugging
    console.log("Reset Password Request:", {
      token: req.params.token,
      body: req.body,
      method: req.method,
    });

    // Restrict to PATCH requests
    if (req.method !== "PATCH") {
      return res
        .status(405)
        .json({ status: "error", message: "Method not allowed. Use PATCH." });
    }

    // Validate password
    const { password } = req.body;
    if (!password) {
      return res
        .status(400)
        .json({ status: "fail", message: "Password is required" });
    }
    if (password.length < 8) {
      return res.status(400).json({
        status: "fail",
        message: "Password must be at least 8 characters",
      });
    }

    // Hash the token from params
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    // Find user with valid token
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select("+password"); // Include password field if needed for validation

    if (!user) {
      return res
        .status(400)
        .json({ status: "fail", message: "Token is invalid or expired" });
    }

    // Update password and clear reset fields
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    // Save user, catch validation or save errors
    await user.save({ validateBeforeSave: true }).catch((err) => {
      console.error("User save error:", err);
      throw new Error(`User save failed: ${err.message}`);
    });

    // Call createSendToken
    createSendToken(user, 200, req, res);
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({
      status: "error",
      message: `Password reset failed: ${err.message} `,
    });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { passwordCurrent, password } = req.body;

    if (!passwordCurrent || !password) {
      return res
        .status(400)
        .json({ status: "fail", message: "Provide current and new passwords" });
    }

    const user = await User.findById(req.user.id).select("+password");
    if (!(await user.correctPassword(passwordCurrent, user.password))) {
      return res
        .status(401)
        .json({ status: "fail", message: "Current password is incorrect" });
    }

    user.password = password;
    await user.save();

    createSendToken(user, 200, req, res);
  } catch (err) {
    res
      .status(500)
      .json({ status: "error", message: "Password update failed" });
  }
};
