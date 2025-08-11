// index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// Initialize DB (adjust path if your setup differs)
const sequelize = require("./db"); // if you use ./config/db, point to that
const db = require("./models");

// ---- Express app ----
const app = express();

// ✅ Allowed frontends (fix: split the merged string)
const FRONTENDS = [
  "https://servezy.in",
  "https://glistening-taffy-7be8bf.netlify.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: FRONTENDS,
    credentials: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: "Content-Type, Authorization, X-Requested-With",
  })
);
app.use(express.json());

// ---- HTTP + Socket.IO ----
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: FRONTENDS,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

// Expose io + emit helpers to routes/controllers
app.set("io", io);
app.set("emitToVendor", (vendorId, event, payload) => {
  if (!vendorId) return;
  io.to(`vendor:${vendorId}`).emit(event, payload);
});
app.set("emitToUser", (userId, event, payload) => {
  if (!userId) return;
  io.to(`user:${userId}`).emit(event, payload);
});

// Rooms: vendors & users join after the client authenticates
io.on("connection", (socket) => {
  // Join vendor room
  socket.on("vendor:join", (vendorId) => {
    if (!vendorId) return;
    socket.join(`vendor:${vendorId}`);
  });

  // Join user room
  socket.on("user:join", (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
  });

  socket.on("disconnect", () => {
    // no-op
  });
});

// ---- Routes ----
const authRoutes = require("./routes/authRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const menuItemRoutes = require("./routes/menuItemRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");

console.log("✅ Registering auth routes");
app.use("/api/auth", authRoutes);

console.log("✅ Registering vendor routes");
app.use("/api/vendors", vendorRoutes);

console.log("✅ Registering menu item routes");
app.use("/api/menu-items", menuItemRoutes);

console.log("✅ Registering order routes");
app.use("/api/orders", (req, res, next) => {
  // Make emit helpers available on req for convenience
  req.io = io;
  req.emitToVendor = app.get("emitToVendor");
  req.emitToUser = app.get("emitToUser");
  next();
}, orderRoutes);

console.log("✅ Registering admin routes");
app.use("/api/admin", adminRoutes);

// Health & root
app.get("/ping", (req, res) => res.send("pong"));
app.get("/", (req, res) => res.send("✅ Cloud Kitchen Backend is live!"));

// 404 fallback
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// ---- Start ----
const PORT = process.env.PORT || 5000;

db.sequelize
  .sync({ alter: true })
  .then(async () => {
    console.log("✅ DB synced successfully");

    // Optional: list tables once at boot
    try {
      const tables = await db.sequelize.getQueryInterface().showAllTables();
      console.log("🧩 Tables in DB:", tables);
    } catch {}

    server.listen(PORT, () => {
      console.log(`🚀 Server (HTTP + Socket.IO) listening on port ${PORT}`);
      console.log("✅ Connecting to database:", process.env.DB_NAME);
    });
  })
  .catch((err) => {
    console.error("❌ DB sync failed:", err);
    process.exit(1);
  });