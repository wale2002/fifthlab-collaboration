const AppError = require("../utils/appError");

// Handle invalid MongoDB ObjectId
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

// Handle duplicate fields (like email)
const handleDuplicateFieldsDB = (err) => {
  const value = err.keyValue ? Object.values(err.keyValue)[0] : "duplicate";
  const message = `Duplicate field value: '${value}'. Please use another value!`;
  return new AppError(message, 400);
};

// Handle Mongoose validation errors
const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join(". ")}`;
  return new AppError(message, 400);
};

// Handle invalid JWT
const handleJWTError = () =>
  new AppError("Invalid token. Please log in again.", 401);

// Handle expired JWT
const handleJWTExpiredError = () =>
  new AppError("Your token has expired. Please log in again.", 401);

// Development error response
const sendErrorDev = (err, req, res) => {
  if (req.originalUrl.startsWith("/api")) {
    // API error response
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    });
  }

  // Rendered website error response
  console.error("ERROR 💥", err);
  return res.status(err.statusCode).render("error", {
    title: "Something went wrong!",
    msg: err.message,
  });
};

// Production error response
const sendErrorProd = (err, req, res) => {
  if (req.originalUrl.startsWith("/api")) {
    // API error response
    if (err.isOperational) {
      return res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
      });
    }

    // Unknown or programming error
    console.error("ERROR 💥", err);
    return res.status(500).json({
      status: "error",
      message: "Something went very wrong!",
    });
  }

  // Rendered website error response
  if (err.isOperational) {
    return res.status(err.statusCode).render("error", {
      title: "Something went wrong!",
      msg: err.message,
    });
  }

  console.error("ERROR 💥", err);
  return res.status(err.statusCode).render("error", {
    title: "Something went wrong!",
    msg: "Please try again later.",
  });
};

// Central global error handler
module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  if (process.env.NODE_ENV === "development") {
    sendErrorDev(err, req, res);
  } else if (process.env.NODE_ENV === "production") {
    let error = Object.create(err);

    if (error.name === "CastError") error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === "ValidationError")
      error = handleValidationErrorDB(error);
    if (error.name === "JsonWebTokenError") error = handleJWTError();
    if (error.name === "TokenExpiredError") error = handleJWTExpiredError();

    sendErrorProd(error, req, res);
  }
};
