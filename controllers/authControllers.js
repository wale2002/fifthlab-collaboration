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
    status: "success",
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
    } = req.body;

    // 1. Validate required fields for main user
    if (!firstName || !lastName || !email || !password) {
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

    // 3. Check if accountName already exists (active users only)

    // 4. Create the main user
    const newUser = await User.create({
      firstName,
      lastName,
      email,
      password,
      role: "Viewer",
      isInvited: false,
    });

    // 5. Create the team member if provided
    if (teamMemberEmail) {
      const tempPassword = crypto.randomBytes(8).toString("hex");

      const teamMember = await User.create({
        firstName: "Team",
        lastName: "Member",
        email: teamMemberEmail,
        accountName: accountName, // same accountName as main user
        password: tempPassword,
        role: teamMemberRole || "Viewer",
        isInvited: true,
      });

      try {
        await new Email(teamMember, tempPassword).sendTemporaryPassword();
      } catch (emailErr) {
        console.error("Email failed to send to team member:", emailErr);
      }
    }

    // 6. Send success response
    res.status(201).json({
      status: "success",
      data: { user: newUser },
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message,
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
  res.cookie("jwt", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  res.status(200).json({ status: "success" });
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
    return res
      .status(401)
      .json({ status: "fail", message: "Invalid or expired token" });
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

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ status: "fail", message: "Permission denied" });
    }
    next();
  };
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ status: "fail", message: "Provide an email" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ status: "fail", message: "No user with that email" });
    }

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const resetURL = `${req.protocol}://${req.get(
      "host"
    )}/api/v1/users/resetPassword/${resetToken}`;

    await new Email(user, resetURL).sendPasswordReset();
    res.status(200).json({
      status: "success",
      message: "Token sent to email",
    });
  } catch (err) {
    console.error("Email sending error:", err);
    res.status(500).json({
      status: "error",
      message: "Email could not be sent",
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ status: "fail", message: "Token is invalid or expired" });
    }

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    createSendToken(user, 200, req, res);
  } catch (err) {
    res.status(500).json({ status: "error", message: "Password reset failed" });
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
