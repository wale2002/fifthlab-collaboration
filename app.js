const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const helmet = require("helmet");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const messageRoutes = require("./routes/messageRoutes");
const AppError = require("./utils/appError");
const globalErrorHandler = require("./controllers/errorControllers");
const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://127.0.0.1:3000",
    credentials: true,
  })
);

app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Route handlers
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/messages", messageRoutes);

app.use(globalErrorHandler);
// Handle unknown routes
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!, 404`));
});

module.exports = app;
