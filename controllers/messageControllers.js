const Message = require("../models/messageModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

exports.sendMessage = catchAsync(async (req, res, next) => {
  const { receiverEmail, content } = req.body;

  if (!receiverEmail || !content) {
    return next(new AppError("Receiver email and content are required", 400));
  }

  const receiver = await User.findOne({ email: receiverEmail });
  if (!receiver) {
    return next(new AppError("Receiver not found", 404));
  }
  if (receiver._id.equals(req.user._id)) {
    return next(new AppError("You cannot message yourself", 400));
  }

  const message = await Message.create({
    sender: req.user._id,
    receiver: receiver._id,
    text: content,
  });

  const populated = await message.populate("sender receiver", "name email");

  // Emit message via Socket.IO
  const io = req.app.get("io"); // Access io from app
  const receiverSocketId = req.app.get("activeUsers")[receiver._id.toString()];
  if (receiverSocketId) {
    io.to(receiverSocketId).emit("receiveMessage", {
      senderId: req.user._id,
      message: populated,
    });
  }

  res.status(201).json({ status: "success", data: { message: populated } });
});

exports.getMessagesBetweenUsers = catchAsync(async (req, res, next) => {
  const messages = await Message.find({
    $or: [
      { sender: req.user._id, receiver: req.params.userId },
      { sender: req.params.userId, receiver: req.user._id },
    ],
  })
    .sort({ createdAt: 1 })
    .populate("sender receiver", "name email");

  res.status(200).json({
    status: "success",
    results: messages.length,
    data: { messages },
  });
});

exports.getInbox = catchAsync(async (req, res) => {
  const messages = await Message.aggregate([
    {
      $match: { $or: [{ sender: req.user._id }, { receiver: req.user._id }] },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: { sender: "$sender", receiver: "$receiver" },
        message: { $first: "$$ROOT" },
      },
    },
    { $replaceRoot: { newRoot: "$message" } },
    { $sort: { createdAt: -1 } },
  ]);

  const populated = await Message.populate(messages, [
    { path: "sender", select: "name email" },
    { path: "receiver", select: "name email" },
  ]);

  res.status(200).json({
    status: "success",
    results: populated.length,
    data: { messages: populated },
  });
});

exports.getAllMessages = catchAsync(async (req, res) => {
  const messages = await Message.find().populate(
    "sender receiver",
    "name email"
  );
  res.status(200).json({
    status: "success",
    results: messages.length,
    data: { messages },
  });
});

exports.getChatWithUser = catchAsync(async (req, res, next) => {
  const { receiverEmail } = req.query;

  if (!receiverEmail) {
    return next(new AppError("Receiver email is required", 400));
  }

  const receiver = await User.findOne({ email: receiverEmail });
  if (!receiver) {
    return next(new AppError("No user found with that email", 404));
  }

  const messages = await Message.find({
    $or: [
      { sender: req.user._id, receiver: receiver._id },
      { sender: receiver._id, receiver: req.user._id },
    ],
  })
    .sort("createdAt")
    .populate("sender receiver", "name email");

  res.status(200).json({
    status: "success",
    results: messages.length,
    data: { messages },
  });
});
