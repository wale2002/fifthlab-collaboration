const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: ".env" });

// Validate JWT_SECRET
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is not defined in config.env");
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error("❌ JWT_SECRET is too short. Use at least 32 characters.");
  process.exit(1);
}

const app = require("./app");
const http = require("http");
const socketio = require("socket.io");

const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const activeUsers = {};

io.on("connection", (socket) => {
  console.log("✅ New client connected:", socket.id);
  socket.on("join", (userId) => {
    activeUsers[userId] = socket.id;
    console.log("📲 User joined:", userId);
    io.emit("userStatus", { userId, status: "online" });
  });
  socket.on("sendMessage", ({ senderId, receiverId, message }) => {
    const receiverSocketId = activeUsers[receiverId];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("receiveMessage", { senderId, message });
    }
  });
  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
    for (const [userId, id] of Object.entries(activeUsers)) {
      if (id === socket.id) {
        delete activeUsers[userId];
        io.emit("userStatus", { userId, status: "offline" });
        break;
      }
    }
  });
});

app.set("io", io);
app.set("activeUsers", activeUsers);

const DB = process.env.DATABASE.replace(
  "<PASSWORD>",
  process.env.DATABASE_PASSWORD
);
mongoose.connect(DB).then(() => console.log("✅ DB connection successful"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}...`);
});
