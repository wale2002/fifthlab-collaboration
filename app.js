const dotenv = require("dotenv");

dotenv.config({ path: ".env" });
const path = require("path");

const express = require("express");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const helmet = require("helmet");
const cors = require("cors");
const testRoutes = require("./routes/testRoutes");
const userRoutes = require("./routes/userRoutes");
const messageRoutes = require("./routes/messageRoutes");
const healthCheck = require("./routes/healthRoutes");

const AppError = require("./utils/appError");
const globalErrorHandler = require("./controllers/errorControllers");
const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL || "https://fifthlab-collaboration.onrender.com",
  "http://localhost:3000",
  "http://localhost:3000/",
  "https://msg-app-5mwq.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new AppError(`CORS policy: Origin ${origin} not allowed`, 403));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
// Serve static files
app.use(express.static(path.join(__dirname, "public")));

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Route handlers
app.get("/", (req, res) => {
  res.send("Hello World!");
});
app.get("/favicon.ico", (req, res) => res.status(204).end());
app.get("/api/v1/health", healthCheck);
app.use("/", testRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/messages", messageRoutes);

app.use(globalErrorHandler);
// Handle unknown routes
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!, 404`));
});
app.use((err, req, res, next) => {
  res.status(err.statusCode || 500).json({
    status: err.status || "error",
    message: err.message,
  });
});

module.exports = app;
