const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });

const app = require("./app");

// Create HTTP server and bind Socket.IO

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

// Listen on the PORT defined by environment or fallback to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}...`);
});
