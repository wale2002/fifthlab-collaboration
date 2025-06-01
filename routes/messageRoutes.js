const express = require("express");
const messageController = require("../controllers/messageControllers");
const authController = require("../controllers/authControllers");

const router = express.Router();

// Protect all routes
router.use(authController.protect);

router.get("/", messageController.getMessages);
router.get("/:id", messageController.getMessageDetails);
router.post("/", messageController.sendMessage);
router.patch("/:id/read", messageController.markAsRead);
router.patch("/:id/archive", messageController.toggleArchive);

module.exports = router;
