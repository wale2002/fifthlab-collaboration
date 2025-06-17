// routes/userRoutes.js
const express = require("express");
const authController = require("../controllers/authControllers"); // Fix typo: authControllers -> authController
const userController = require("../controllers/userController");

const router = express.Router();

// Public routes
router.post("/signup", authController.signup); // Fix: Remove parentheses
router.post("/login", authController.login);
router.get("/logout", authController.logout);
router.post("/forgotPassword", authController.forgotPassword);
router.patch("/resetPassword/:token", authController.resetPassword);

// Protected routes
router.use(authController.protect);

router.patch("/updateMyPassword", authController.updatePassword);
router.get("/me", userController.getMe, userController.getUser);
router.patch("/updateMe", userController.updateMe);
router.delete("/deleteMe", userController.deleteMe);
router.get("/search", userController.searchUsers);
// Admin routes
// router.use(authController.restrictTo("admin"));

// router.get("/", userController.getAllUsers);
router.get("/:id", userController.getUser);
router.patch("/:id", userController.updateUser);
router.delete("/:id", userController.deleteUser);
router.post("/", userController.createUser);

module.exports = router;
