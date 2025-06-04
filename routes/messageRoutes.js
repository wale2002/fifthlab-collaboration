const express = require("express");
const messageController = require("../controllers/messageControllers");
const authController = require("../controllers/authControllers");

const router = express.Router();

// Protect all routes
router.use(authController.protect);

// Chat-related routes
router.post("/chats", messageController.createChat); // Create a new chat (one-on-one or group)
router.get("/chats", messageController.getChats); // Get all chats for the authenticated user

// Message-related routes
router.get("/", messageController.getMessages); // Get messages for a specific chat
router.post("/", messageController.sendMessage); // Send a message to a chat
router.patch("/chats/:chatId/read", messageController.markAsRead); // Mark all messages in a chat as read
router.patch("/chats/:id/archive", messageController.toggleArchive); // Toggle archive status for a chat

// User-related routes
router.get("/users", messageController.getAllUsers); // Get all active users for chat initiation

module.exports = router;
