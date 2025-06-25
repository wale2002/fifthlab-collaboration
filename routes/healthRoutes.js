// backend: routes/health.js
const express = require("express");

const router = express.Router();
router.get("/", async (req, res) => {
  res.status(200).json({ status: "success", message: "Server is up" });
});

module.exports = router;
