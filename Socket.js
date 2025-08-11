// socket.js
const { Server } = require("socket.io");

let io;

function initSocket(server, origins) {
  io = new Server(server, {
    cors: {
      origin: origins,
      methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
      credentials: true,
    },
  });

  // Rooms: vendor & user
  io.on("connection", (socket) => {
    socket.on("vendor:join", (vendorId) => {
      if (vendorId) socket.join(`vendor:${vendorId}`);
    });
    socket.on("user:join", (userId) => {
      if (userId) socket.join(`user:${userId}`);
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

module.exports = {
  initSocket,
  getIO,
  emitToVendor,
  emitToUser,
};
