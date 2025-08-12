
// index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// ---- DB ----
const db = require("./models");           // Sequelize models (includes sequelize instance)
require("./db");                          // (ok if your connection is initialized here)

// ---- Express app ----
const app = express();

// Allowed frontend origins (env first, fallback to known hosts)
const DEFAULT_ORIGINS = [
  "https://servezy.in",
  "https://glistening-taffy-7be8bf.netlify.app",
  "http://localhost:3000",
];
const FRONTENDS = (process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : DEFAULT_ORIGINS
).map((s) => s.trim()).filter(Boolean);

// CORS (allow no-Origin requests for health checks)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return FRONTENDS.includes(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  allowedHeaders: "Content-Type, Authorization, X-Requested-With",
}));
app.use(express.json());

// ---- HTTP + Socket.IO ----
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTENDS, credentials: true },
});

// Expose io + helpers so routes/controllers can emit easily
const emitToVendor = (vendorId, event, payload) => {
  if (!vendorId) return;
  io.to(`vendor:${vendorId}`).emit(event, payload);
};
const emitToUser = (userId, event, payload) => {
  if (!userId) return;
  io.to(`user:${userId}`).emit(event, payload);
};
app.set("io", io);
app.set("emitToVendor", emitToVendor);
app.set("emitToUser", emitToUser);

// Socket rooms
io.on("connection", (socket) => {
  socket.on("vendor:join", (vendorId) => vendorId && socket.join(`vendor:${vendorId}`));
  socket.on("user:join", (userId) => userId && socket.join(`user:${userId}`));
});

// ---- Routes ----
const authRoutes = require("./routes/authRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const menuItemRoutes = require("./routes/menuItemRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const pushRoutes = require("./routes/pushRoutes");
const { VAPID_PUBLIC_KEY } = require("./utils/push"); // for /public-key

app.use("/api/auth", authRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/menu-items", menuItemRoutes);

// attach emit helpers for order routes
app.use("/api/orders", (req, _res, next) => {
  req.emitToVendor = emitToVendor;
  req.emitToUser = emitToUser;
  next();
}, orderRoutes);

app.use("/api/push", pushRoutes);

// Public key endpoint used by the frontend
app.get("/public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || "" });
});

app.use("/api/admin", adminRoutes);

// Health & root
app.get("/ping", (_req, res) => res.send("pong"));
app.get("/", (_req, res) => res.send("✅ Cloud Kitchen Backend is live!"));

// 404 fallback
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// ---- Start ----
const PORT = process.env.PORT || 5000;

db.sequelize.sync({ alter: true })
  .then(async () => {
    console.log("✅ DB synced successfully");
    try {
      const tables = await db.sequelize.getQueryInterface().showAllTables();
      console.log("🧩 Tables in DB:", tables);
    } catch {}
    server.listen(PORT, () => {
      console.log(`🚀 Server (HTTP + Socket.IO) listening on port ${PORT}`);
      console.log("🌐 Allowed origins:", FRONTENDS.join(", "));
      console.log("✅ Connecting to database:", process.env.DB_NAME);
    });
  })
  .catch((err) => {
    console.error("❌ DB sync failed:", err);
    process.exit(1);
  });