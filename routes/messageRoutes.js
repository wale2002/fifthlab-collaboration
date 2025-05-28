const express = require("express");
const messageController = require("../controllers/messageControllers");
const authController = require("../controllers/authControllers");

const router = express.Router();

// router.use(authController.protect);

router.post("/", messageController.sendMessage);
router.get(
  "/all",
  authController.restrictTo("admin"),
  messageController.getAllMessages
);
router.get("/", messageController.getInbox);
router.get("/chat", messageController.getChatWithUser);
router.get("/:userId", messageController.getMessagesBetweenUsers);

module.exports = router;
