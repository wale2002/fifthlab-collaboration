const mongoose = require("mongoose");
const { Schema } = mongoose;

const chatSchema = new Schema(
  {
    members: [
      {
        user: { type: mongoose.Schema.ObjectId, ref: "User", required: true },
        unreadCount: { type: Number, default: 0 },
      },
    ],
    lastMessage: {
      type: mongoose.Schema.ObjectId,
      ref: "Message",
    },
    isGroupChat: {
      type: Boolean,
      default: false,
    },
    groupName: {
      type: String,
      trim: true,
      maxlength: [50, "Group name cannot exceed 50 characters"],
      required: function () {
        return this.isGroupChat;
      },
    },
    groupAdmin: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true }
);

// Populate members and lastMessage
chatSchema.pre(/^find/, function (next) {
  this.populate({
    path: "members.user",
    select: "firstName lastName",
  }).populate({
    path: "lastMessage",
    select: "content preview timestamp",
  });
  next();
});

const Chat = mongoose.model("Chat", chatSchema);
module.exports = Chat;
