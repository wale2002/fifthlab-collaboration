const mongoose = require("mongoose");
const dotenv = require("dotenv");
const http = require("http");
dotenv.config();
const app = require("./app");

// Connect to MongoDB database
const DB = process.env.DATABASE.replace(
  "<PASSWORD>",
  process.env.DATABASE_PASSWORD
);

mongoose
  .connect(DB)
  .then(() => console.log("✅ DB connection successful"))
  .catch((err) => {
    console.error("❌ DB connection error:", err);
    process.exit(1);
  });

// Create HTTP server with the Express app

// Listen on the PORT defined by environment or fallback to 3000
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on the port ${PORT}...`);
});
