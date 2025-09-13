
// socket.js
const { Server } = require("socket.io");

let io;

function initSocket(server, origins) {
  io = new Server(server, {
    path: "/socket.io",
    cors: {
      origin: origins, // array of allowed frontends
      methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    allowEIO3: true, // tolerate older client versions
  });

  io.on("connection", (socket) => {
    console.log("🔌 socket connected", socket.id);

    // join “rooms”
    socket.on("vendor:join", (vendorId) => vendorId && socket.join(`vendor:${vendorId}`));
    socket.on("user:join",   (userId)   => userId   && socket.join(`user:${userId}`));

    socket.on("auth:refresh", () => {
      // add token checks here if you’d like
    });

    socket.on("disconnect", (reason) => {
      console.log("🔌 socket disconnected:", reason);
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

function emitToVendor(vendorId, event, payload) {
  if (!io || !vendorId) return;
  io.to(`vendor:${vendorId}`).emit(event, payload);
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
}

module.exports = { initSocket, getIO, emitToVendor, emitToUser };