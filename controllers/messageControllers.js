const Message = require("../models/messageModel");
const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

// server/controllers/messageController.js
exports.createChat = catchAsync(async (req, res, next) => {
  const { recipient, isGroupChat } = req.body;
  const currentUser = req.user;

  if (!recipient && !isGroupChat) {
    return next(new AppError("Recipient is required for direct chats", 400));
  }

  const recipientUser = await User.findById(recipient);
  if (!recipientUser) {
    return next(new AppError("Recipient not found", 404));
  }

  const members = [
    { userId: currentUser._id, name: currentUser.name, unreadCount: 0 },
    { userId: recipientUser._id, name: recipientUser.name, unreadCount: 0 },
  ];

  const chat = await Chat.create({
    isGroupChat,
    members,
    groupName: isGroupChat ? req.body.groupName : undefined,
  });

  res.status(201).json({
    success: true,
    data: {
      id: chat._id.toString(),
      isGroupChat: chat.isGroupChat,
      members: chat.members,
      groupName: chat.groupName,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    },
  });
});

exports.getChats = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    sortBy = "updatedAt",
    sortOrder = "desc",
  } = req.query;
  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

  const chats = await Chat.find({
    members: { $elemMatch: { user: req.user._id } },
  })
    .sort(sort)
    .skip(skip)
    .limit(Number(limit))
    .select("members lastMessage isGroupChat groupName");

  res.status(200).json({
    status: "success",
    results: chats.length,
    data: {
      chats: chats.map((chat) => ({
        id: chat._id,
        isGroupChat: chat.isGroupChat,
        groupName: chat.groupName,
        members: chat.members.map((m) => ({
          userId: m.user._id,
          name: `${m.user.firstName} ${m.user.lastName}`,
          unreadCount: m.unreadCount,
        })),
        lastMessage: chat.lastMessage
          ? {
              content: chat.lastMessage.preview,
              timestamp: chat.lastMessage.timestamp,
            }
          : null,
      })),
    },
  });
});

exports.getMessages = catchAsync(async (req, res, next) => {
  const { chatId, filter, page = 1, limit = 20 } = req.query;
  if (!chatId) {
    return next(new AppError("Chat ID is required", 400));
  }

  // Verify user is part of the chat
  const chat = await Chat.findOne({
    _id: chatId,
    members: { $elemMatch: { user: req.user._id } },
  });
  if (!chat) {
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  const query = { chat: chatId };
  if (filter === "unread") query.isRead = false;

  const messages = await Message.find(query)
    .populate("sender", "firstName lastName")
    .sort("-timestamp")
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.status(200).json({
    status: "success",
    results: messages.length,
    data: {
      messages: messages.map((msg) => ({
        id: msg._id,
        sender: msg.sender._id,
        senderName: `${msg.sender.firstName} ${msg.sender.lastName}`,
        content: msg.content,
        timestamp: msg.timestamp,
        isRead: msg.isRead,
      })),
    },
  });
});

exports.sendMessage = catchAsync(async (req, res, next) => {
  const { chatId, content } = req.body;

  if (!chatId || !content) {
    return next(new AppError("Chat ID and content are required", 400));
  }

  // Verify user is part of the chat
  const chat = await Chat.findOne({
    _id: chatId,
    members: { $elemMatch: { user: req.user._id } },
  });
  if (!chat) {
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  const message = await Message.create({
    sender: req.user._id,
    chat: chatId,
    content,
  });

  // Update chat's lastMessage and increment unreadCount for other members
  chat.lastMessage = message._id;
  chat.members.forEach((member) => {
    if (member.user.toString() !== req.user._id.toString()) {
      member.unreadCount += 1;
    }
  });
  await chat.save();

  res.status(201).json({
    status: "success",
    message: "Message sent successfully",
    data: {
      id: message._id,
      content: message.content,
      timestamp: message.timestamp,
    },
  });
});

exports.markAsRead = catchAsync(async (req, res, next) => {
  const { chatId } = req.params;

  // Verify user is part of the chat
  const chat = await Chat.findOne({
    _id: chatId,
    members: { $elemMatch: { user: req.user._id } },
  });
  if (!chat) {
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  // Mark all messages in the chat as read for the user
  await Message.updateMany({ chat: chatId, isRead: false }, { isRead: true });

  // Reset unreadCount for the user
  chat.members = chat.members.map((member) => {
    if (member.user.toString() === req.user._id.toString()) {
      member.unreadCount = 0;
    }
    return member;
  });
  await chat.save();

  res.status(200).json({
    status: "success",
    message: "Messages marked as read",
  });
});

exports.getAllUsers = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50, search } = req.query;
  const skip = (page - 1) * limit;

  const query = { active: true, _id: { $ne: req.user._id } };
  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
    ];
  }

  const users = await User.find(query)
    .select("firstName lastName email accountName profilePicture")
    .skip(skip)
    .limit(Number(limit));

  res.status(200).json({
    status: "success",
    results: users.length,
    data: {
      users: users.map((user) => ({
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        accountName: user.accountName,
        profilePicture: user.profilePicture,
      })),
    },
  });
});

exports.toggleArchive = catchAsync(async (req, res, next) => {
  const chat = await Chat.findOne({
    _id: req.params.id,
    members: { $elemMatch: { user: req.user._id } },
  });

  if (!chat) {
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  chat.isArchived = !chat.isArchived;
  await chat.save();

  res.status(200).json({
    status: "success",
    message: `Chat ${chat.isArchived ? "archived" : "unarchived"} successfully`,
    data: {
      id: chat._id,
      isArchived: chat.isArchived,
    },
  });
});
