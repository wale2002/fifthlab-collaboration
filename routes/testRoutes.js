// routes/testRoutes.js
const express = require("express");
const axios = require("axios");

const router = express.Router();

router.get("/test-firebase-certs", async (req, res) => {
  try {
    const response = await axios.get(
      "https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys",
      { timeout: 5000 }
    );
    const certs = response.data;
    console.log("Firebase cert keys:", Object.keys(certs));
    res
      .status(200)
      .json({ status: "success", keys: Object.keys(certs), certs });
  } catch (err) {
    console.error("Error fetching Firebase certs:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
