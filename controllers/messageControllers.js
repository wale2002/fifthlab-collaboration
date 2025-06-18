const Message = require("../models/messageModel");
const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const Pusher = require("pusher");

// Initialize Pusher with .env variables
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || "2009889",
  key: process.env.PUSHER_KEY || "836f3176a2c384401b6a",
  secret: process.env.PUSHER_SECRET || "3cb40dbdca917a3ce057",
  cluster: process.env.PUSHER_CLUSTER || "mt1",
  useTLS: true,
});

exports.createChat = catchAsync(async (req, res, next) => {
  console.log("createChat Request Body:", req.body);
  console.log("Current User:", req.user);
  const { recipients, isGroupChat, groupName } = req.body;
  const currentUser = req.user;

  if (!currentUser) {
    console.error("No authenticated user found");
    return next(new AppError("User not authenticated", 401));
  }

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    console.error("Invalid recipients:", recipients);
    return next(new AppError("At least one recipient is required", 400));
  }

  try {
    const recipientUsers = await User.find({ _id: { $in: recipients } });
    console.log(
      "Found Recipients:",
      recipientUsers.map((u) => u._id.toString())
    );
    if (recipientUsers.length !== recipients.length) {
      console.error("Some recipients not found:", recipients);
      return next(new AppError("One or more recipients not found", 404));
    }

    const members = [
      { user: currentUser._id, unreadCount: 0 },
      ...recipientUsers.map((u) => ({ user: u._id, unreadCount: 0 })),
    ];

    const chatData = {
      isGroupChat,
      members,
      ...(isGroupChat &&
        groupName && { groupName, groupAdmin: [currentUser._id] }),
    };

    console.log("Chat Data:", chatData);
    const chat = await Chat.create(chatData);
    await chat.populate("members.user", "firstName lastName accountName email");
    console.log("Created Chat:", chat);

    pusher.trigger("chats", "new-chat", { chatId: chat._id.toString() });

    res.status(201).json({
      success: true,
      data: {
        id: chat._id.toString(),
        isGroupChat: chat.isGroupChat,
        groupName: chat.groupName,
        members: chat.members.map((m) => ({
          userId: m.user._id.toString(),
          name:
            m.user.accountName ||
            `${m.user.firstName} ${m.user.lastName || ""}`.trim(),
          email: m.user.email,
          unreadCount: m.unreadCount,
        })),
        lastMessage: null,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      },
      message: "Chat created successfully",
    });
  } catch (error) {
    console.error("createChat Error:", error);
    return next(new AppError(`Failed to create chat: ${error.message}`, 500));
  }
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
      createdAt: chat.createdAt,
    })),
  });
});

exports.getMessages = catchAsync(async (req, res, next) => {
  const { chatId, filter, page = 1, limit = 20 } = req.query;
  if (!chatId) {
    return next(new AppError("Chat ID is required", 400));
  }

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

  if (!chatId || (!content && !photo)) {
    return next(new AppError("Chat ID and content or photo are required", 400));
  }

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
    photo,
    isRead: false,
  });

  await message.populate("sender", "firstName lastName");

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

  const messagePayload = {
    id: message._id.toString(),
    sender: message.sender._id.toString(),
    senderName: `${message.sender.firstName} ${message.sender.lastName}`,
    content: message.content,
    photo: message.photo,
    timestamp: message.createdAt,
    isRead: message.isRead,
  };

  pusher.trigger("chats", "message-sent", { chatId: chatId.toString() });
  pusher.trigger(`chat-${chatId}`, "new-message", messagePayload);

  res.status(201).json({
    status: "success",
    message: "Message sent successfully",
    data: messagePayload,
  });
});

exports.markAsRead = catchAsync(async (req, res, next) => {
  const { chatId } = req.params;

  const chat = await Chat.findOne({
    _id: chatId,
    members: { $elemMatch: { user: req.user._id } },
  });
  if (!chat) {
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  await Message.updateMany({ chat: chatId, isRead: false }, { isRead: true });

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
