const mongoose = require("mongoose");
const pino = require("pino");
const Pusher = require("pusher");
const Message = require("../models/messageModel");
const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const ErrorResponse = require("../utils/errorResponse");
// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

// Initialize Pusher with environment variables
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

exports.createChat = catchAsync(async (req, res, next) => {
  const { recipients, isGroupChat, groupName } = req.body;
  const currentUser = req.user;

  logger.info(
    { userId: currentUser._id.toString(), recipients, isGroupChat },
    "Creating chat"
  );

  // Validate recipients
  if (!Array.isArray(recipients) || recipients.length === 0) {
    logger.warn({ recipients }, "Invalid recipients");
    return next(new AppError("Recipients must be a non-empty array.", 400));
  }

  // Prevent current user from being in recipients
  if (recipients.includes(currentUser._id.toString())) {
    logger.warn(
      { userId: currentUser._id.toString(), recipients },
      "Current user cannot be in recipients"
    );
    return next(
      new AppError("You cannot include yourself in recipients.", 400)
    );
  }

  // Validate recipient IDs
  const validRecipients = await User.find({ _id: { $in: recipients } }).select(
    "_id"
  );
  if (validRecipients.length !== recipients.length) {
    logger.warn({ recipients }, "One or more recipient IDs are invalid");
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
      const chatData = {
        id: existingChat._id.toString(),
        isGroupChat: existingChat.isGroupChat,
        groupName: existingChat.groupName,
        members: existingChat.members.map((m) => ({
          userId: m.user._id.toString(),
          name: m.user.accountName || `${m.user.firstName} ${m.user.lastName}`,
          unreadCount: m.unreadCount,
        })),
        createdAt: existingChat.createdAt,
      };
      try {
        await pusher.trigger("chats", "new-chat", chatData);
        logger.info(
          { chatId: existingChat._id.toString() },
          "Pusher event triggered for existing chat"
        );
      } catch (error) {
        logger.error({ error: error.message }, "Pusher trigger failed");
      }
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
    logger.warn({ groupName }, "Invalid group name");
    return next(new AppError("Group name is required for group chats.", 400));
  }

  // Create unique members array
  const uniqueMembers = [
    { user: currentUser._id, unreadCount: 0 },
    ...recipients
      .filter((id) => id !== currentUser._id.toString())
      .map((id) => ({ user: id, unreadCount: 0 })),
  ];

  const chatData = {
    isGroupChat: Boolean(isGroupChat),
    members: uniqueMembers,
    groupName: isGroupChat ? groupName : undefined,
    groupAdmin: isGroupChat ? [currentUser._id] : undefined,
  };

  const chat = await Chat.create(chatData);
  await chat.populate("members.user");

  const chatPayload = {
    id: chat._id.toString(),
    isGroupChat: chat.isGroupChat,
    groupName: chat.groupName,
    members: chat.members.map((m) => ({
      userId: m.user._id.toString(),
      name:
        m.user.accountName || `${m.user.firstName} ${m.user.lastName}`.trim(),
      unreadCount: m.unreadCount,
    })),
    createdAt: chat.createdAt,
  };

  try {
    await pusher.trigger("chats", "new-chat", chatPayload);
    logger.info(
      { chatId: chat._id.toString() },
      "Pusher event triggered for new chat"
    );
  } catch (error) {
    logger.error({ error: error.message }, "Pusher trigger failed");
  }

  logger.info({ chatId: chat._id.toString() }, "Chat created successfully");

  res.status(201).json({
    success: true,
    data: chat,
    message: "Chat created successfully",
  });
});
// exports.getChats = catchAsync(async (req, res, next) => {
//   const chats = await Chat.find({
//     "members.user": req.user._id,
//   }).lean();

//   res.status(200).json({
//     status: "success",
//     data: chats.map((chat) => ({
//       id: chat._id.toString(),
//       isGroupChat: chat.isGroupChat,
//       groupName: chat.groupName,
//       members: chat.members.map((m) => ({
//         userId: m.user._id.toString(),
//         name: m.user.accountName || `${m.user.firstName} ${m.user.lastName}`,
//         unreadCount: m.unreadCount,
//       })),
//       lastMessage: chat.lastMessage
//         ? {
//             content: chat.lastMessage.content,
//             preview: chat.lastMessage.preview,
//             timestamp: chat.lastMessage.timestamp.toISOString(),
//             isRead: chat.lastMessage.isRead,
//           }
//         : null,
//       createdAt: chat.createdAt.toISOString(),
//       groupAdmin: chat.groupAdmin.map((admin) => admin._id.toString()),
//     })),
//   });
// });

exports.getChats = catchAsync(async (req, res, next) => {
  const { search } = req.query;
  logger.info({ userId: req.user._id.toString(), search }, "Fetching chats");

  let chats = await Chat.find({ "members.user": req.user._id }).populate(
    "members.user",
    "firstName lastName accountName"
  );

  logger.info({ chatCount: chats.length }, "Chats retrieved from database");

  chats.forEach((chat, index) => {
    logger.debug(
      { chatId: chat._id.toString(), members: chat.members },
      `Chat ${index} members`
    );
  });

  if (search && typeof search === "string") {
    chats = chats.filter((chat) =>
      chat.isGroupChat
        ? chat.groupName?.toLowerCase().includes(search.toLowerCase())
        : chat.members.some(
            (m) =>
              m.user &&
              m.user._id.toString() !== req.user._id.toString() &&
              `${m.user.firstName || ""} ${m.user.lastName || ""}`
                .toLowerCase()
                .includes(search.toLowerCase())
          )
    );
    logger.info(
      { search, filteredCount: chats.length },
      "Chats filtered by search"
    );
  }

  res.status(200).json({
    success: true,
    data: chats.map((chat) => ({
      id: chat._id.toString(),
      isGroupChat: chat.isGroupChat,
      groupName: chat.groupName,
      isArchived: chat.isArchived || false,
      members: chat.members.map((m) => ({
        userId: m.user?._id?.toString() || "unknown",
        name: m.user
          ? m.user.accountName ||
            `${m.user.firstName || ""} ${m.user.lastName || ""}`.trim() ||
            "Unknown User"
          : "Unknown User",
        unreadCount: m.unreadCount || 0,
      })),
      lastMessage: chat.lastMessage
        ? {
            id: chat.lastMessage._id?.toString() || "unknown",
            content: chat.lastMessage.content || "",
            photo: chat.lastMessage.photo || "",
            timestamp: chat.lastMessage.createdAt || null,
          }
        : null,
      createdAt: chat.createdAt,
    })),
  });
});

// exports.deleteChat = catchAsync(async (req, res, next) => {
//   console.log("deleteChat called:", {
//     chatId: req.params.id,
//     userId: req.user.id,
//     userActive: req.user.active,
//   });

//   const chat = await Chat.findById(req.params.id);
//   if (!chat) {
//     return next(new ErrorResponse("Chat not found", 404));
//   }

//   const userId = req.user.id.toString();
//   const isMember = chat.members.some(
//     (member) => member.user.toString() === userId
//   );
//   if (!isMember) {
//     return next(new ErrorResponse("User is not a member of this chat", 403));
//   }

//   await Message.deleteMany({ chat: chat._id });
//   await Chat.deleteOne({ _id: chat._id });

//   res.status(200).json({
//     success: true,
//     data: { chatId: req.params.id },
//     message: "Chat deleted successfully",
//   });
// });

exports.deleteChat = catchAsync(async (req, res, next) => {
  const chatId = req.params.id;
  const userId = req.user.id;

  console.log("🗑️ deleteChat called:", {
    chatId,
    userId,
    userActive: req.user.active,
  });

  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return res.status(400).json({ status: "fail", message: "Invalid chat ID" });
  }

  const chat = await Chat.findById(chatId);

  if (!chat) {
    return res.status(404).json({ status: "fail", message: "Chat not found" });
  }

  // Log members for debugging
  console.log(
    "🧾 Chat members:",
    chat.members.map((m) => m.user.toString())
  );

  const isMember = chat.members.some(
    (member) =>
      (member.user._id || member.user).toString() === userId.toString()
  );

  if (!isMember) {
    return res.status(403).json({
      status: "fail",
      message: "User is not a member of this chat",
    });
  }

  await Message.deleteMany({ chat: chat._id });
  console.log("🧹 Messages deleted for chat:", chat._id);

  await Chat.deleteOne({ _id: chat._id });
  console.log("✅ Chat deleted:", chat._id);

  res.status(200).json({
    success: true,
    data: { chatId },
    message: "Chat deleted successfully",
  });
});

exports.getMessages = catchAsync(async (req, res, next) => {
  const { chatId, filter, page = 1, limit = 20 } = req.query;

  // Validate chatId
  if (!chatId) {
    logger.warn({ userId: req.user?._id.toString() }, "Chat ID is required");
    return next(new AppError("Chat ID is required", 400));
  }
  if (!mongoose.isValidObjectId(chatId)) {
    logger.warn(
      { chatId, userId: req.user?._id.toString() },
      "Invalid Chat ID format"
    );
    return next(new AppError("Invalid Chat ID format", 400));
  }

  // Validate req.user
  if (!req.user || !req.user._id) {
    logger.warn({ chatId }, "User not authenticated");
    return next(new AppError("User not authenticated", 401));
  }

  logger.info({ chatId, userId: req.user._id.toString() }, "Fetching messages");

  const chat = await Chat.findOne({
    _id: chatId,
    members: { $elemMatch: { user: req.user._id } },
  }).populate("members.user", "firstName lastName accountName");

  if (!chat) {
    logger.warn(
      { chatId, userId: req.user._id.toString() },
      "Chat not found or user not a member"
    );
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  const query = { chat: chatId };
  if (filter === "unread") query.isRead = false;

  const pageNum = isNaN(page) || page < 1 ? 1 : Number(page);
  const limitNum = isNaN(limit) || limit < 1 ? 20 : Number(limit);

  const messages = await Message.find(query)
    .populate("sender", "firstName lastName accountName")
    .sort("-createdAt")
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  logger.info(
    { chatId, messageCount: messages.length },
    "Messages fetched successfully"
  );

  res.status(200).json({
    status: "success",
    results: messages.length,
    data: {
      chat: {
        id: chat._id.toString(),
        isGroupChat: chat.isGroupChat || false,
        groupName: chat.groupName || "",
        members: chat.members.map((m) => ({
          userId: m.user ? m.user._id.toString() : "unknown",
          name: m.user
            ? m.user.accountName ||
              `${m.user.firstName || ""} ${m.user.lastName || ""}`.trim() ||
              "Unknown User"
            : "Unknown User",
          unreadCount: m.unreadCount || 0,
        })),
      },
      messages: messages.map((msg) => ({
        id: msg._id.toString(),
        sender: msg.sender ? msg.sender._id.toString() : "unknown",
        senderName: msg.sender
          ? msg.sender.accountName ||
            `${msg.sender.firstName || ""} ${
              msg.sender.lastName || ""
            }`.trim() ||
            "Unknown User"
          : "Unknown User",
        content: msg.content || "",
        photo: msg.photo || "",
        timestamp: msg.createdAt,
        isRead: msg.isRead,
      })),
    },
  });
});

exports.sendMessage = catchAsync(async (req, res, next) => {
  const { chatId, content, photo } = req.body;
  if (!chatId || !content) {
    return next(new Error("Chat ID and content are required"));
  }

  const chat = await Chat.findOne({
    _id: chatId,
    "members.user": req.user._id,
  }).lean();
  if (!chat) {
    return next(new Error("Chat not found or user not a member"));
  }

  const message = await Message.create({
    sender: req.user._id,
    chat: chatId,
    content,
    photo,
    timestamp: new Date(), // Explicitly set
  });
  await message.populate("sender", "firstName lastName accountName");

  await Chat.findByIdAndUpdate(chatId, {
    lastMessage: message._id,
  });

  const messagePayload = {
    id: message._id.toString(),
    sender: message.sender._id.toString(),
    senderName:
      message.sender.accountName ||
      `${message.sender.firstName} ${message.sender.lastName}`,
    content: message.content,
    photo: message.photo,
    timestamp: message.timestamp.toISOString(),
    isRead: message.isRead,
  };

  pusher.trigger(`chat-${chatId}`, "new-message", messagePayload);
  pusher.trigger("chats", "message-sent", { chatId });

  res.status(201).json({
    status: "success",
    data: messagePayload,
  });
});
// exports.sendMessage = catchAsync(async (req, res, next) => {
//   const { chatId, content, photo } = req.body;

//   // Validate inputs
//   if (!chatId || (!content && !photo)) {
//     logger.warn(
//       { chatId, userId: req.user?._id.toString() },
//       "Chat ID and content or photo are required"
//     );
//     return next(new AppError("Chat ID and content or photo are required", 400));
//   }
//   if (!mongoose.isValidObjectId(chatId)) {
//     logger.warn(
//       { chatId, userId: req.user?._id.toString() },
//       "Invalid Chat ID format"
//     );
//     return next(new AppError("Invalid Chat ID format", 400));
//   }

//   // Validate req.user
//   if (!req.user || !req.user._id) {
//     logger.warn({ chatId }, "User not authenticated");
//     return next(new AppError("User not authenticated", 401));
//   }

//   logger.info({ chatId, userId: req.user._id.toString() }, "Sending message");

//   const chat = await Chat.findOne({
//     _id: chatId,
//     members: { $elemMatch: { user: req.user._id } },
//   })
//     .populate("members.user", "firstName lastName accountName")
//     .lean();

//   if (!chat) {
//     logger.warn(
//       { chatId, userId: req.user._id.toString() },
//       "Chat not found or user not a member"
//     );
//     return next(new AppError("Chat not found or you are not a member", 404));
//   }

//   logger.debug({ chatId, members: chat.members }, "Chat members retrieved");

//   const message = await Message.create({
//     sender: req.user._id,
//     chat: chatId,
//     content: content || "",
//     photo: photo || "",
//     isRead: false,
//   });

//   await message.populate("sender", "firstName lastName accountName");

//   chat.lastMessage = {
//     _id: message._id,
//     content: message.content,
//     photo: message.photo,
//     createdAt: message.createdAt,
//   };
//   chat.members.forEach((member) => {
//     if (member.user?._id?.toString() !== req.user._id.toString()) {
//       member.unreadCount = (member.unreadCount || 0) + 1;
//     }
//   });
//   await chat.save();

//   const messagePayload = {
//     id: message._id.toString(),
//     sender: message.sender?._id?.toString() || "unknown",
//     senderName: message.sender
//       ? message.sender.accountName ||
//         `${message.sender.firstName || ""} ${
//           message.sender.lastName || ""
//         }`.trim() ||
//         "Unknown User"
//       : "Unknown User",
//     content: message.content || "",
//     photo: message.photo || "",
//     timestamp: message.createdAt,
//     isRead: message.isRead,
//   };

//   try {
//     await pusher.trigger("chats", "message-sent", {
//       chatId: chatId.toString(),
//     });
//     await pusher.trigger(`chat-${chatId}`, "new-message", messagePayload);
//     logger.info(
//       { chatId, messageId: message._id.toString() },
//       "Pusher events triggered"
//     );
//   } catch (error) {
//     logger.error(
//       { chatId, error: error.message },
//       "Failed to trigger Pusher events"
//     );
//   }

//   res.status(201).json({
//     status: "success",
//     message: "Message sent successfully",
//     data: messagePayload,
//   });
// });

exports.markAsRead = catchAsync(async (req, res, next) => {
  const { chatId } = req.params;

  // Validate chatId
  if (!mongoose.isValidObjectId(chatId)) {
    logger.warn(
      { chatId, userId: req.user?._id.toString() },
      "Invalid Chat ID format"
    );
    return next(new AppError("Invalid Chat ID format", 400));
  }

  // Validate req.user
  if (!req.user || !req.user._id) {
    logger.warn({ chatId }, "User not authenticated");
    return next(new AppError("User not authenticated", 401));
  }

  logger.info(
    { chatId, userId: req.user._id.toString() },
    "Marking messages as read"
  );

  const chat = await Chat.findOne({
    _id: chatId,
    members: { $elemMatch: { user: req.user._id } },
  });

  if (!chat) {
    logger.warn(
      { chatId, userId: req.user._id.toString() },
      "Chat not found or user not a member"
    );
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  await Message.updateMany({ chat: chatId, isRead: false }, { isRead: true });

  chat.members = chat.members.map((member) => {
    if (member.user?._id.toString() === req.user._id.toString()) {
      member.unreadCount = 0;
    }
    return member;
  });
  await chat.save();

  logger.info({ chatId }, "Messages marked as read successfully");

  res.status(200).json({
    status: "success",
    message: "Messages marked as read",
  });
});

exports.getAllUsers = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50, search } = req.query;
  const pageNum = isNaN(page) || page < 1 ? 1 : Number(page);
  const limitNum = isNaN(limit) || limit < 1 ? 50 : Number(limit);
  const skip = (pageNum - 1) * limitNum;

  logger.info(
    { userId: req.user._id.toString(), page, limit, search },
    "Fetching users"
  );

  const query = { active: true, _id: { $ne: req.user._id } };
  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { accountName: { $regex: search, $options: "i" } },
    ];
  }

  const users = await User.find(query)
    .select("firstName lastName email accountName")
    .skip(skip)
    .limit(limitNum);

  logger.info({ userCount: users.length }, "Users fetched successfully");

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
  const chatId = req.params.id;
  logger.info(
    { chatId, userId: req.user._id.toString() },
    "Toggling chat archive status"
  );

  const chat = await Chat.findOne({
    _id: chatId,
    members: { $elemMatch: { user: req.user._id } },
  });

  if (!chat) {
    logger.warn(
      { chatId, userId: req.user._id.toString() },
      "Chat not found or user not a member"
    );
    return next(new AppError("Chat not found or you are not a member", 404));
  }

  chat.isArchived = !chat.isArchived;
  await chat.save();

  logger.info(
    { chatId, isArchived: chat.isArchived },
    "Chat archive status updated"
  );

  res.status(200).json({
    status: "success",
    message: `Chat ${chat.isArchived ? "archived" : "unarchived"} successfully`,
    data: {
      id: chat._id.toString(),
      isArchived: chat.isArchived,
    },
  });
});

// DELETE /api/v1/messages/:id

exports.deleteMessage = catchAsync(async (req, res, next) => {
  const messageId = req.params.id;
  const userId = req.user.id;

  console.log("🧾 deleteMessage called", {
    messageId,
    userId,
  });

  const message = await Message.findById(messageId);

  if (!message) {
    console.log("❌ Message not found");
    return res.status(404).json({
      status: "fail",
      message: "Message not found",
    });
  }

  console.log("📨 Message found", {
    sender: message.sender.toString(),
    loggedInUser: userId,
  });

  // Ensure only the sender can delete the message
  const senderId =
    typeof message.sender === "object"
      ? message.sender._id?.toString()
      : message.sender.toString();

  if (senderId !== userId.toString()) {
    console.log("⛔ Unauthorized delete attempt");
    return res.status(403).json({
      status: "fail",
      message: "You are not allowed to delete this message",
    });
  }

  // const deletedMessage = await Message.findByIdAndDelete(messageId);

  // if (!deletedMessage) {
  //   console.log("❌ Message not deleted");
  //   return res.status(404).json({
  //     status: "fail",
  //     message: "Message could not be deleted",
  //   });
  // }

  // console.log("✅ Message deleted", deletedMessage);
  message.isDeleted = true;
  await message.save();

  // Emit the Pusher event after deletion
  // try {
  //   const pusher = new Pusher(process.env.PUSHER_KEY, {
  //     cluster: process.env.PUSHER_CLUSTER,
  //     encrypted: true,
  //   });
  //   pusher.trigger(`chat-${message.chatId}`, "message-deleted", { messageId });
  //   console.log("Pusher event triggered successfully");
  // } catch (error) {
  //   console.error("Pusher error:", error);
  // }
  const chatId = message.chat?._id?.toString?.() || message.chat?.toString?.();
  if (!chatId) {
    return res.status(400).json({
      status: "fail",
      message: "Message is missing chat reference",
    });
  }
  await pusher.trigger(`chat-${chatId}`, "message-deleted", { messageId });

  res.status(200).json({
    status: "success",
    message: "Message deleted successfully",
    data: { messageId },
  });
});
