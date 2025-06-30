const express = require("express");
const messageController = require("../controllers/messageControllers");
const authController = require("../controllers/authControllers");

const router = express.Router();

// Protect all routes
router.use(authController.protect);

// Chat-related routes
router.get("/chats", messageController.getChats);
router.post("/chats", messageController.createChat);
router.get("/", messageController.getMessages);
router.post("/", messageController.sendMessage);
router.patch("/chats/:chatId/markAsRead", messageController.markAsRead);
router.patch("/chats/:id", messageController.toggleArchive);
router.delete("/chats/:id", messageController.deleteChat);

// User-related routes
router.get("/users", messageController.getAllUsers); // Get all active users for chat initiation

module.exports = router;
