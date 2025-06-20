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
  const { recipients, isGroupChat, groupName } = req.body;
  const currentUser = req.user;

  // Validate recipients
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return next(new AppError("Recipients must be a non-empty array.", 400));
  }

  // Validate recipient IDs
  const validRecipients = await User.find({ _id: { $in: recipients } }).select(
    "_id"
  );
  if (validRecipients.length !== recipients.length) {
    return next(new AppError("One or more recipient IDs are invalid.", 400));
  }

  // Check for duplicate one-on-one chat
  if (!isGroupChat && recipients.length === 1) {
    const existingChat = await Chat.findOne({
      isGroupChat: false,
      members: {
        $all: [{ user: currentUser._id }, { user: recipients[0] }],
        $size: 2,
      },
    }).populate("members.user");
    if (existingChat) {
      pusher.trigger("chats", "new-chat", {
        id: existingChat._id.toString(),
        isGroupChat: existingChat.isGroupChat,
        groupName: existingChat.groupName,
        members: existingChat.members.map((m) => ({
          userId: m.user._id.toString(),
          name: m.user.accountName || `${m.user.firstName} ${m.user.lastName}`,
          unreadCount: m.unreadCount,
        })),
        createdAt: existingChat.createdAt,
      });
      return res.status(200).json({
        success: true,
        data: existingChat._id.toString(),
        message: "Existing chat found",
      });
    }
  }

  // Validate groupName for group chats
  if (
    isGroupChat &&
    (!groupName || typeof groupName !== "string" || groupName.trim() === "")
  ) {
    return next(new AppError("Group name is required for group chats.", 400));
  }

  const chatData = {
    isGroupChat: Boolean(isGroupChat),
    members: [
      { user: currentUser._id, unreadCount: 0 },
      ...recipients.map((id) => ({ user: id, unreadCount: 0 })),
    ],
    groupName: isGroupChat ? groupName : undefined,
    groupAdmin: isGroupChat ? [currentUser._id] : undefined,
  };

  const chat = await Chat.create(chatData);
  await chat.populate("members.user");

  pusher.trigger("chats", "new-chat", {
    id: chat._id.toString(),
    isGroupChat: chat.isGroupChat,
    groupName: chat.groupName,
    members: chat.members.map((m) => ({
      userId: m.user._id.toString(),
      name: m.user.accountName || `${m.user.firstName} ${m.user.lastName}`,
      unreadCount: m.unreadCount,
    })),
    createdAt: chat.createdAt,
  });

  res.status(201).json({
    success: true,
    data: chat,
    message: "Chat created successfully",
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
