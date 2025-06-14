const jwt = require("jsonwebtoken");
const { promisify } = require("util");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/userModel");
const Email = require("../utils/email");
const crypto = require("crypto");
const validator = require("validator");

const client = new OAuth2Client({
  clientId: process.env.GOOGLE_CLIENT_ID,
  jwksUri:
    "https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys", // Firebase certs
});
const verifyManually = async (idToken, audience) => {
  try {
    const response = await axios.get(
      "https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys"
    );
    const certs = response.data;
    console.log("Manually fetched certs:", Object.keys(certs));

    const decoded = jwt.decode(idToken, { complete: true });
    const kid = decoded.header.kid;
    const pem = certs[kid];

    if (!pem) {
      throw new Error(`No PEM found for kid: ${kid}`);
    }

    const verified = jwt.verify(idToken, pem, {
      audience: [audience, "auth-47fbd"],
      issuer: "https://securetoken.google.com/auth-47fbd",
    });
    return verified;
  } catch (err) {
    throw new Error(`Manual verification failed: ${err.message}`);
  }
};
const verifyWithRetry = async (
  idToken,
  audience,
  retries = 3,
  delay = 1000
) => {
  for (let i = 0; i < retries; i++) {
    try {
      const certs = await client.getFederatedSignonCertsAsync();
      const certKeys = Object.keys(certs);
      console.log("Fetched Firebase certs:", certKeys.length, "keys", certKeys);
      const ticket = await client.verifyIdToken({
        idToken,
        audience: [audience, "auth-47fbd"], // Support both Google Client ID and Firebase project ID
      });
      return ticket;
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(
        `Retry ${i + 1}/${retries} for token verification: ${err.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

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

// Load allowed email domains from .env
const ALLOWED_EMAIL_DOMAINS = process.env.ALLOWED_EMAIL_DOMAINS
  ? process.env.ALLOWED_EMAIL_DOMAINS.split(",").map((domain) =>
      domain.trim().toLowerCase()
    )
  : ["@company.com"];

exports.signup = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      accountName,
      password,
      idToken,
      teamMemberEmail,
      teamMemberRole,
    } = req.body;

    // 1. Validate required fields
    if (!firstName || !lastName || !email || !accountName) {
      return res.status(400).json({
        status: "fail",
        message: "First name, last name, email, and account name are required",
      });
    }

    // 2. Validate emails
    if (!validator.isEmail(email)) {
      return res.status(400).json({ status: "fail", message: "Invalid email" });
    }
    if (process.env.NODE_ENV === "production") {
      const emailDomain = `@${email.split("@")[1].toLowerCase()}`;
      if (!ALLOWED_EMAIL_DOMAINS.includes(emailDomain)) {
        return res.status(403).json({
          status: "fail",
          message: `Email must end with one of: ${ALLOWED_EMAIL_DOMAINS.join(
            ", "
          )}`,
        });
      }
    }
    if (teamMemberEmail) {
      if (!validator.isEmail(teamMemberEmail)) {
        return res.status(400).json({
          status: "fail",
          message: "Invalid team member email",
        });
      }
      if (process.env.NODE_ENV === "production") {
        const teamEmailDomain = `@${teamMemberEmail
          .split("@")[1]
          .toLowerCase()}`;
        if (!ALLOWED_EMAIL_DOMAINS.includes(teamEmailDomain)) {
          return res.status(403).json({
            status: "fail",
            message: `Team member email must end with one of: ${ALLOWED_EMAIL_DOMAINS.join(
              ", "
            )}`,
          });
        }
      }
    }

    // 3. Check for existing users
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        status: "fail",
        message: "Email already in use",
      });
    }
    if (teamMemberEmail) {
      const existingTeamMember = await User.findOne({ email: teamMemberEmail });
      if (existingTeamMember) {
        return res.status(400).json({
          status: "fail",
          message: "Team member email already in use",
        });
      }
    }

    // 4. Handle Google Sign-In
    let userData = {
      firstName,
      lastName,
      email,
      accountName,
      role: "Viewer",
      isInvited: false,
      isOAuth: false,
    };

    if (idToken) {
      console.log("Signup idToken:", idToken.substring(0, 10) + "...");
      const ticket = await verifyWithRetry(
        idToken,
        process.env.GOOGLE_CLIENT_ID
      );
      const payload = ticket.getPayload();
      console.log("Signup token payload:", payload);

      if (!payload.email_verified) {
        return res.status(400).json({
          status: "fail",
          message: "Email not verified by Google",
        });
      }
      if (process.env.NODE_ENV === "production") {
        const googleEmailDomain = `@${payload.email
          .split("@")[1]
          .toLowerCase()}`;
        if (!ALLOWED_EMAIL_DOMAINS.includes(googleEmailDomain)) {
          return res.status(403).json({
            status: "fail",
            message: `Google email must end with one of: ${ALLOWED_EMAIL_DOMAINS.join(
              ", "
            )}`,
          });
        }
      }

      userData = {
        ...userData,
        firstName: firstName || payload.given_name,
        lastName: lastName || payload.family_name,
        email: payload.email,
        isOAuth: true,
      };

      if (password) {
        userData.password = password; // Let userModel.js hash
      }
    } else {
      if (!password) {
        return res.status(400).json({
          status: "fail",
          message: "Password is required for regular signup",
        });
      }
      userData.password = password; // Let userModel.js hash
    }

    // 5. Create main user
    const newUser = await User.create(userData);

    // 6. Send welcome email
    const loginUrl = `${req.protocol}://${req.get("host")}/login`;
    try {
      await new Email(newUser, loginUrl).sendWelcome();
    } catch (emailErr) {
      console.error("Failed to send welcome email:", emailErr);
    }

    // 7. Create team member if provided
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
        isOAuth: false,
      });

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

    // 8. Send JWT response
    createSendToken(newUser, 201, req, res);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        status: "fail",
        message: "Email already in use",
      });
    }
    console.error("Signup error:", err.message, err.stack);
    res.status(500).json({
      status: "error",
      message: `Signup failed: ${err.message}`,
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, idToken } = req.body;

    if (!email) {
      return res.status(400).json({
        status: "fail",
        message: "Email is required",
      });
    }

    if (idToken) {
      console.log("Login idToken:", idToken.substring(0, 10) + "...");
      const ticket = await verifyWithRetry(
        idToken,
        process.env.GOOGLE_CLIENT_ID
      );
      const payload = ticket.getPayload();
      console.log("Login token payload:", payload);

      if (!payload.email_verified) {
        return res.status(400).json({
          status: "fail",
          message: "Email not verified by Google",
        });
      }
      if (process.env.NODE_ENV === "production") {
        const googleEmailDomain = `@${payload.email
          .split("@")[1]
          .toLowerCase()}`;
        if (!ALLOWED_EMAIL_DOMAINS.includes(googleEmailDomain)) {
          return res.status(403).json({
            status: "fail",
            message: `Google email must end with one of: ${ALLOWED_EMAIL_DOMAINS.join(
              ", "
            )}`,
          });
        }
      }

      const user = await User.findOne({ email: payload.email });
      if (!user) {
        return res.status(401).json({
          status: "fail",
          message: "No account found. Please sign up first.",
        });
      }
      if (!user.isOAuth) {
        return res.status(400).json({
          status: "fail",
          message: "This account was not created with Google Sign-In",
        });
      }

      createSendToken(user, 200, req, res);
    } else {
      // Regular login
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({
          status: "fail",
          message: "Password is required for regular login",
        });
      }

      const user = await User.findOne({ email }).select("+password");
      if (!user || !(await user.correctPassword(password, user.password))) {
        return res.status(401).json({
          status: "fail",
          message: "Incorrect email or password",
        });
      }
      if (user.isOAuth) {
        return res.status(400).json({
          status: "fail",
          message: "This account uses Google Sign-In",
        });
      }

      createSendToken(user, 200, req, res);
    }
  } catch (err) {
    console.error("Login error:", err.message, err.stack);
    res.status(500).json({
      status: "error",
      message: `Login failed: ${err.message}`,
    });
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

    if (!token || token === "loggedout") {
      return res.status(401).json({
        status: "fail",
        message: "Not logged in",
      });
    }

    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    const currentUser = await User.findById(decoded.id);

    if (!currentUser) {
      return res.status(401).json({
        status: "fail",
        message: "User no longer exists",
      });
    }

    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({
        status: "fail",
        message: "Password recently changed",
      });
    }

    req.user = currentUser;
    res.locals.user = currentUser;
    next();
  } catch (err) {
    console.error("Protect middleware error:", err);
    return res.status(401).json({
      status: "fail",
      message: "Invalid or expired token",
      error: err.message,
    });
  }
};

exports.isLoggedIn = async (req, res, next) => {
  try {
    if (!req.cookies?.jwt || req.cookies.jwt === "loggedout") return next();

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

exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "No user found with that email",
      });
    }
    if (user.isOAuth) {
      return res.status(400).json({
        status: "fail",
        message: "Use Google Sign-In to access this account",
      });
    }

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const resetURL = `${req.protocol}://${req.get(
      "host"
    )}/api/resetPassword/${resetToken}`;

    try {
      await new Email(user, resetURL).sendPasswordReset();
      res.status(200).json({
        status: "success",
        message: "Token sent to email!",
      });
    } catch (emailErr) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      throw emailErr;
    }
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to send email",
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    if (req.method !== "PATCH") {
      return res.status(405).json({
        status: "error",
        message: "Method not allowed. Use PATCH.",
      });
    }

    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({
        status: "fail",
        message: "Password must be at least 8 characters",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select("+password");

    if (!user) {
      return res.status(400).json({
        status: "fail",
        message: "Token is invalid or expired",
      });
    }
    if (user.isOAuth) {
      return res.status(400).json({
        status: "fail",
        message: "Use Google Sign-In to access this account",
      });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save();

    createSendToken(user, 200, req, res);
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({
      status: "error",
      message: "Password reset failed",
    });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { passwordCurrent, password } = req.body;

    if (!passwordCurrent || !password) {
      return res.status(400).json({
        status: "fail",
        message: "Provide current and new passwords",
      });
    }

    const user = await User.findById(req.user.id).select("+password");
    if (user.isOAuth) {
      return res.status(400).json({
        status: "fail",
        message: "Use Google Sign-In to manage this account",
      });
    }
    if (!(await user.correctPassword(passwordCurrent, user.password))) {
      return res.status(401).json({
        status: "fail",
        message: "Current password is incorrect",
      });
    }

    user.password = password;
    await user.save();

    createSendToken(user, 200, req, res);
  } catch (err) {
    console.error("Update password error:", err);
    res.status(500).json({
      status: "error",
      message: "Password update failed",
    });
  }
};
