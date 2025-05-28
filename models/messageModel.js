const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "A message must have a sender"],
    },
    receiver: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "A message must have a receiver"],
    },
    text: {
      type: String,
      required: [true, "Message cannot be empty"],
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

messageSchema.pre(/^find/, function (next) {
  this.populate("sender", "name email").populate("receiver", "name email");
  next();
});

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;
