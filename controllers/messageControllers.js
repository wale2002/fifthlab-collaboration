const Message = require("../models/messageModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

exports.getMessages = catchAsync(async (req, res, next) => {
  const { filter } = req.query;
  const query = { recipient: req.user._id };

  if (filter === "unread") query.isRead = false;
  else if (filter === "archived") query.isArchived = true;

  const messages = await Message.find(query)
    .populate("sender", "firstName lastName")
    .sort("-timestamp");

  res.status(200).json({
    status: "success",
    results: messages.length,
    data: {
      messages: messages.map((msg) => ({
        id: msg._id,
        sender: msg.sender._id,
        senderName: `${msg.sender.firstName} ${msg.sender.lastName}`,
        preview: msg.preview,
        timestamp: msg.timestamp,
        isRead: msg.isRead,
        isArchived: msg.isArchived,
      })),
    },
  });
});

exports.getMessageDetails = catchAsync(async (req, res, next) => {
  const message = await Message.findOne({
    _id: req.params.id,
    recipient: req.user._id,
  }).populate("sender", "firstName lastName");

  if (!message) {
    return next(new AppError("No message found with that ID", 404));
  }

  if (!message.isRead) {
    message.isRead = true;
    await message.save();
  }

  res.status(200).json({
    status: "success",
    data: {
      id: message._id,
      sender: message.sender._id,
      senderName: `${message.sender.firstName} ${message.sender.lastName}`,
      content: message.content,
      timestamp: message.timestamp,
      isRead: message.isRead,
      isArchived: message.isArchived,
    },
  });
});

exports.sendMessage = catchAsync(async (req, res, next) => {
  const { recipient, content } = req.body;

  if (!recipient || !content) {
    return next(new AppError("Recipient and content are required", 400));
  }

  const recipientUser = await User.findOne({ _id: recipient, active: true });
  if (!recipientUser) {
    return next(new AppError("Recipient does not exist or is inactive", 404));
  }

  const message = await Message.create({
    sender: req.user._id,
    recipient,
    content,
  });

  res.status(201).json({
    status: "success",
    message: "Message sent successfully",
    data: {
      id: message._id,
    },
  });
});

exports.markAsRead = catchAsync(async (req, res, next) => {
  const message = await Message.findOne({
    _id: req.params.id,
    recipient: req.user._id,
  });

  if (!message) {
    return next(new AppError("No message found with that ID", 404));
  }

  message.isRead = true;
  await message.save();

  res.status(200).json({
    status: "success",
    message: "Message marked as read",
    data: {
      id: message._id,
      isRead: message.isRead,
    },
  });
});

exports.toggleArchive = catchAsync(async (req, res, next) => {
  const message = await Message.findOne({
    _id: req.params.id,
    recipient: req.user._id,
  });

  if (!message) {
    return next(new AppError("No message found with that ID", 404));
  }

  message.isArchived = !message.isArchived;
  await message.save();

  res.status(200).json({
    status: "success",
    message: `Message ${
      message.isArchived ? "archived" : "unarchived"
    } successfully`,
    data: {
      id: message._id,
      isArchived: message.isArchived,
    },
  });
});
