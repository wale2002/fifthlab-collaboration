const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
    required: [true, "A message must have a sender"],
  },
  chat: {
    type: mongoose.Schema.ObjectId,
    ref: "Chat",
    required: [true, "A message must belong to a chat"],
  },
  content: {
    type: String,
    required: [true, "A message must have content"],
    trim: true,
    maxlength: [1000, "Message content cannot exceed 1000 characters"],
  },
  preview: {
    type: String,
    trim: true,
    maxlength: [100, "Preview cannot exceed 100 characters"],
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Generate preview before saving
messageSchema.pre("save", function (next) {
  if (this.isNew) {
    this.preview =
      this.content.substring(0, 50) + (this.content.length > 50 ? "..." : "");
  }
  next();
});

// Populate sender details
messageSchema.pre(/^find/, function (next) {
  this.populate({
    path: "sender",
    select: "firstName lastName",
  });
  next();
});

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;
