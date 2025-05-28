const jwt = require("jsonwebtoken");
const { promisify } = require("util");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const Email = require("../utils/email");
const crypto = require("crypto");
const validator = require("validator");

const signToken = (id) => {
  console.log("JWT_SECRET during signing:", process.env.JWT_SECRET);
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, req, res) => {
  const token = signToken(user._id);
  console.log("Generated Token:", token);

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

exports.signup = catchAsync(async (req, res, next) => {
  console.log("Signup endpoint hit with body:", req.body);

  const {
    firstName,
    lastName,
    email,
    accountName,
    password,
    teamMemberEmail,
    teamMemberRole,
  } = req.body;

  // Validate required fields
  const missingFields = [];
  if (!firstName || firstName.trim() === "") missingFields.push("firstName");
  if (!lastName || lastName.trim() === "") missingFields.push("lastName");
  if (!email || email.trim() === "") missingFields.push("email");
  if (!accountName || accountName.trim() === "")
    missingFields.push("accountName");
  if (!password || password.trim() === "") missingFields.push("password");

  if (missingFields.length > 0) {
    console.log("Missing fields detected:", missingFields);
    return next(
      new AppError(`
        Missing or empty required fields: ${missingFields.join(", ")},
        400`)
    );
  }

  // Validate email format
  if (!validator.isEmail(email)) {
    return next(new AppError("Please provide a valid email address", 400));
  }
  if (teamMemberEmail && !validator.isEmail(teamMemberEmail)) {
    return next(new AppError("Please provide a valid team member email", 400));
  }

  // Create primary user
  try {
    const newUser = await User.create({
      firstName,
      lastName,
      email,
      accountName,
      password,
      role: "Viewer",
      isInvited: false,
    });

    // Create invited team member if provided
    let teamMember;
    if (teamMemberEmail) {
      const tempPassword = crypto.randomBytes(8).toString("hex");
      console.log("Generated temp password for team member:", tempPassword);
      teamMember = await User.create({
        firstName: "Team",
        lastName: "Member",
        email: teamMemberEmail,
        accountName: "departmentName",
        password: tempPassword,
        role: teamMemberRole || "Viewer",
        isInvited: true,
      });
      // Send temporary password via email
      try {
        await new Email(teamMember, tempPassword).sendTemporaryPassword();
        console.log(`Temporary password sent to ${teamMemberEmail}`);
      } catch (emailErr) {
        console.error("Error sending temporary password email:", emailErr);
      }
    }

    createSendToken(newUser, 201, req, res);
  } catch (err) {
    console.error("Error creating user:", err);
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue)[0];
      return next(new AppError(`${field} already exists, 400`));
    }
    return next(new AppError("Failed to create user", 500));
  }
});

exports.protect = catchAsync(async (req, res, next) => {
  let token;
  let tokenSource = "none";

  console.log("Request Headers:", req.headers);

  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
    tokenSource = "header";
    if (!token || token === "null" || token === "undefined") {
      console.error(
        "Empty or invalid Bearer token:",
        req.headers.authorization
      );
      return next(
        new AppError(
          "No valid token provided in Authorization header. Please log in.",
          401
        )
      );
    }
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
    tokenSource = "cookie";
    if (token === "null" || token === "undefined") {
      console.error("Invalid JWT cookie:", token);
      return next(
        new AppError("No valid token provided in cookie. Please log in.", 401)
      );
    }
  }

  console.log(`Token Source: ${tokenSource}, Token: ${token}`);
  console.log("JWT_SECRET during verification:", process.env.JWT_SECRET);

  if (!token) {
    return next(
      new AppError("You are not logged in! Please log in to get access", 401)
    );
  }

  if (!token.match(/^[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.[A-Za-z0-9-_]+$/)) {
    console.error("Invalid token format:", token);
    return next(
      new AppError("Invalid token format. Please log in again.", 401)
    );
  }

  let decoded;
  try {
    decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    console.log("Decoded JWT:", decoded);
  } catch (err) {
    console.error("JWT Verification Error:", err.message);
    if (err.name === "JsonWebTokenError") {
      return next(new AppError("Invalid token. Please log in again.", 401));
    }
    if (err.name === "TokenExpiredError") {
      return next(
        new AppError("Your token has expired. Please log in again.", 401)
      );
    }
    return next(new AppError("Authentication error", 401));
  }

  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(
      new AppError("The user belonging to this token no longer exists", 401)
    );
  }

  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError("Password recently changed. Please log in again.", 401)
    );
  }

  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError("Please provide email and password", 400));
  }

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError("Incorrect email or password", 401));
  }

  createSendToken(user, 200, req, res);
});

exports.logout = (req, res) => {
  res.cookie("jwt", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  res.status(200).json({ status: "success" });
};

exports.isLoggedIn = catchAsync(async (req, res, next) => {
  if (!req.cookies?.jwt) return next();

  try {
    const decoded = await promisify(jwt.verify)(
      req.cookies.jwt,
      process.env.JWT_SECRET
    );
    const currentUser = await User.findById(decoded.id);
    if (!currentUser || currentUser.changedPasswordAfter(decoded.iat)) {
      return next();
    }

    res.locals.user = currentUser;
    req.user = currentUser;
    return next();
  } catch (err) {
    return next();
  }
});

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError("You do not have permission to perform this action", 403)
      );
    }
    next();
  };
};

exports.forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return next(new AppError("Please provide an email address", 400));
  }

  const user = await User.findOne({ email });
  if (!user) {
    return next(new AppError("No user found with that email address", 404));
  }

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  try {
    const resetURL = `${req.protocol}://${req.get(
      "host"
    )}/api/v1/users/resetPassword/${resetToken}`;
    await new Email(user, resetURL).sendPasswordReset();

    res.status(200).json({
      status: "success",
      message: "Password reset token sent to email",
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    console.error("Error sending email:", err);
    return next(
      new AppError("Error sending email. Please try again later.", 500)
    );
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError("Token is invalid or has expired", 400));
  }

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  createSendToken(user, 200, req, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  const { passwordCurrent, password } = req.body;

  if (!passwordCurrent || !password) {
    return next(new AppError("Please provide current and new passwords", 400));
  }

  const user = await User.findById(req.user.id).select("+password");
  if (!(await user.correctPassword(passwordCurrent, user.password))) {
    return next(new AppError("Current password is incorrect", 401));
  }

  user.password = password;
  await user.save();

  createSendToken(user, 200, req, res);
});
