// backend/controllers/messageController.js
const Message = require("../models/messageModel");
const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const pusher = require("../pusher");

exports.createChat = catchAsync(async (req, res, next) => {
  const { recipients, isGroupChat, groupName } = req.body;
  const currentUser = req.user;

  // Validate recipients
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return next(new AppError("At least one recipient is required", 400));
  }

  // Validate recipient users
  const recipientUsers = await User.find({ _id: { $in: recipients } });
  if (recipientUsers.length !== recipients.length) {
    return next(new AppError("One or more recipients not found", 404));
  }

  // Include current user in members
  const members = [
    { user: currentUser._id, unreadCount: 0 },
    ...recipientUsers.map((u) => ({ user: u._id, unreadCount: 0 })),
  ];

  // Prepare chat data
  const chatData = {
    isGroupChat,
    members,
    ...(isGroupChat &&
      groupName && { groupName, groupAdmin: [currentUser._id] }),
  };

  // Create chat
  const chat = await Chat.create(chatData);
  await chat.populate("members.user", "firstName lastName");

  // Trigger Pusher event
  pusher.trigger("chats", "new-chat", { chatId: chat._id.toString() });

  // Send response
  res.status(201).json({
    success: true,
    data: {
      id: chat._id.toString(),
      isGroupChat: chat.isGroupChat,
      groupName: chat.groupName,
      members: chat.members.map((m) => ({
        userId: m.user._id.toString(),
        name: `${m.user.firstName} ${m.user.lastName}`,
        unreadCount: m.unreadCount,
      })),
      lastMessage: null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    },
  });
});

exports.getChats = catchAsync(async (req, res, next) => {
  const { search } = req.query;
  let chats = await Chat.find({ "members.user": req.user.id }).populate(
    "members.user",
    "firstName lastName"
  );

  if (search && typeof search === "string") {
    chats = chats.filter((chat) =>
      chat.isGroupChat
        ? chat.groupName?.toLowerCase().includes(search.toLowerCase())
        : chat.members.some(
            (m) =>
              m.user._id.toString() !== req.user.id &&
              `${m.user.firstName} ${m.user.lastName}`
                .toLowerCase()
                .includes(search.toLowerCase())
          )
    );
  }

  res.status(200).json({
    success: true,
    data: chats.map((chat) => ({
      id: chat._id.toString(),
      isGroupChat: chat.isGroupChat,
      groupName: chat.groupName,
      members: chat.members.map((m) => ({
        userId: m.user._id.toString(),
        name: `${m.user.firstName} ${m.user.lastName}`,
        unreadCount: m.unreadCount,
      })),
      lastMessage: chat.lastMessage
        ? {
            id: chat.lastMessage._id,
            content: chat.lastMessage.content,
            photo: chat.lastMessage.photo,
            timestamp: chat.lastMessage.createdAt,
          }
        : null,
      createdAt: chat.createdAt, // Ensure this is included
    })),
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
  }).populate("members.user", "firstName lastName");
  if (!chat) {
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  const query = { chat: chatId };
  if (filter === "unread") query.isRead = false;

  const messages = await Message.find(query)
    .populate("sender", "firstName lastName")
    .sort("-createdAt")
    .skip((page - 1) * limit)
    .limit(Number(limit));

  res.status(200).json({
    status: "success",
    results: messages.length,
    data: {
      chat: {
        id: chat._id.toString(),
        isGroupChat: chat.isGroupChat,
        groupName: chat.groupName,
        members: chat.members.map((m) => ({
          userId: m.user._id.toString(),
          name: `${m.user.firstName} ${m.user.lastName}`,
          unreadCount: m.unreadCount,
        })),
      },
      messages: messages.map((msg) => ({
        id: msg._id.toString(),
        sender: msg.sender._id.toString(),
        senderName: `${msg.sender.firstName} ${msg.sender.lastName}`,
        content: msg.content,
        photo: msg.photo,
        timestamp: msg.createdAt,
        isRead: msg.isRead,
      })),
    },
  });
});

exports.sendMessage = catchAsync(async (req, res, next) => {
  const { chatId, content, photo } = req.body;

  // Validate input
  if (!chatId || (!content && !photo)) {
    return next(new AppError("Chat ID and content or photo are required", 400));
  }

  // Verify user is part of the chat
  const chat = await Chat.findOne({
    _id: chatId,
    members: { $elemMatch: { user: req.user._id } },
  });
  if (!chat) {
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  // Create message
  const message = await Message.create({
    sender: req.user._id,
    chat: chatId,
    content,
    photo,
    isRead: false,
  });

  // Populate sender details
  await message.populate("sender", "firstName lastName");

  // Update chat's lastMessage and increment unreadCount for other members
  chat.lastMessage = {
    _id: message._id,
    content: message.content,
    photo: message.photo,
    createdAt: message.createdAt,
  };
  chat.members.forEach((member) => {
    if (member.user.toString() !== req.user._id.toString()) {
      member.unreadCount += 1;
    }
  });
  await chat.save();

  // Trigger Pusher events
  pusher.trigger("chats", "message-sent", { chatId: chatId.toString() });
  pusher.trigger(`chat-${chatId}`, "new-message", {
    messageId: message._id.toString(),
  });

  // Send response
  res.status(201).json({
    status: "success",
    message: "Message sent successfully",
    data: {
      id: message._id.toString(),
      sender: message.sender._id.toString(),
      senderName: `${message.sender.firstName} ${message.sender.lastName}`,
      content: message.content,
      photo: message.photo,
      timestamp: message.createdAt,
      isRead: message.isRead,
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
    .select("firstName lastName email accountName")
    .skip(skip)
    .limit(Number(limit));

  res.status(200).json({
    status: "success",
    results: users.length,
    data: {
      users: users.map((user) => ({
        id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        accountName: user.accountName,
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
      id: chat._id.toString(),
      isArchived: chat.isArchived,
    },
  });
});
