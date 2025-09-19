
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const morgan = require("morgan");
const path = require("path");

// ---- DB ----
const db = require("./models");

// ---- App ----
const app = express();

// ---- Allowed frontend origins ----
const DEFAULT_ORIGINS = [
  "https://servezy.in",
  "https://www.servezy.in",
  "https://glistening-taffy-7be8bf.netlify.app", // Netlify deploy
  "http://localhost:3000",
  "http://localhost:5173", // vite
];
const FRONTENDS_LIST = (process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : DEFAULT_ORIGINS)
  .map((s) => s.trim())
  .filter(Boolean);

// helper: allow *.netlify.app previews & localhost
const isAllowedOrigin = (origin) => {
  if (!origin) return true; // same-origin / curl / health checks
  if (FRONTENDS_LIST.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith(".netlify.app")) return true;
    if (u.hostname === "localhost") return true;
  } catch {}
  return false;
};

// Trust proxy (Render/Heroku/NGINX) so websocket upgrade works
app.set("trust proxy", 1);

// ---- Security & Middleware ----
app.use(
  cors({
    origin: (origin, cb) => (isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
    credentials: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: "Content-Type, Authorization, X-Requested-With, Idempotency-Key",
  })
);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "tiny" : "dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "250kb" }));

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ---- Rate limits ----
app.use(
  "/api/",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 800,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(
  ["/api/auth/login", "/api/auth/register"],
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---- HTTP server + Socket.IO ----
const server = http.createServer(app);

const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: (origin, cb) => (isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
    credentials: true,
    methods: ["GET", "POST"],
  },
  pingInterval: 25000,
  pingTimeout: 60000,
  allowEIO3: true,
});

// simple auth hook (optional)
io.use((socket, next) => {
  // const token = socket.handshake.auth?.token
  // TODO: verify if needed
  next();
});

// socket helpers exposed to routes
const emitToVendor = (vendorId, event, payload) => vendorId && io.to(`vendor:${vendorId}`).emit(event, payload);
const emitToUser   = (userId, event, payload) => userId && io.to(`user:${userId}`).emit(event, payload);
app.set("io", io);
app.set("emitToVendor", emitToVendor);
app.set("emitToUser", emitToUser);

// Rooms
io.on("connection", (socket) => {
  console.log("🔌 socket connected", socket.id);
  socket.emit("connected", { id: socket.id });

  socket.on("vendor:join", (vendorId) => vendorId && socket.join(`vendor:${vendorId}`));
  socket.on("user:join",   (userId)   => userId   && socket.join(`user:${userId}`));

  socket.on("disconnect", (reason) => {
    console.log("🔌 socket disconnected:", reason);
  });
});

// ---- Routes ----
const { VAPID_PUBLIC_KEY } = require("./utils/push");

const authRoutes     = require("./routes/authRoutes");
const vendorRoutes   = require("./routes/vendorRoutes");
const menuItemRoutes = require("./routes/menuItemRoutes");
const orderRoutes    = require("./routes/orderRoutes");
const adminRoutes    = require("./routes/adminRoutes");
const pushRoutes     = require("./routes/pushRoutes");
const uploadRoutes   = require("./routes/uploadRoutes");

let paymentsRouter = null;
try {
  paymentsRouter = require("./routes/payments");
} catch {
  try {
    paymentsRouter = require("./routes/paymentRoutes");
  } catch {
    console.warn("⚠️  payments router not found — skipping /api/payments");
  }
}

const mountSafe = (p, r) => (r && typeof r === "function" ? app.use(p, r) : console.warn(`⚠️  Skipped mounting ${p}`));
const mountWithEmit = (p, r) =>
  r && typeof r === "function"
    ? app.use(p, (req, _res, next) => {
        req.emitToVendor = emitToVendor;
        req.emitToUser   = emitToUser;
        next();
      }, r)
    : console.warn(`⚠️  Skipped mounting ${p}`);

mountSafe("/api/auth", authRoutes);
mountSafe("/api/vendors", vendorRoutes);
mountSafe("/api/menu-items", menuItemRoutes);
mountWithEmit("/api/orders", orderRoutes);
mountSafe("/api/push", pushRoutes);
mountSafe("/api/admin", adminRoutes);
mountSafe("/api/uploads", uploadRoutes);
if (paymentsRouter) mountWithEmit("/api/payments", paymentsRouter);

app.get("/public-key", (_req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY || "" }));

// Health
app.get("/ping", (_req, res) => res.send("pong"));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.send("✅ Cloud Kitchen Backend is live!"));

// 404 fallback
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// Global error handler
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err.message || err);
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked" });
  }
  res.status(500).json({ message: "Server error" });
});

// ---- Start ----
const PORT = process.env.PORT || 5000;
server.keepAliveTimeout = 65000;
server.headersTimeout   = 66000;

db.sequelize
  .sync({ alter: true })
  .then(async () => {
    console.log("✅ DB synced successfully");
    try {
      const tables = await db.sequelize.getQueryInterface().showAllTables();
      console.log("🧩 Tables in DB:", tables);
    } catch {}
    server.listen(PORT, () => {
      console.log(`🚀 Server (HTTP + Socket.IO) listening on port ${PORT}`);
      console.log("🌐 Allowed origins:", FRONTENDS_LIST.join(", "), " + *.netlify.app + localhost");
      console.log("✅ Connecting to database:", process.env.DB_NAME);
    });
  })
  .catch((err) => {
    console.error("❌ DB sync failed:", err);
    process.exit(1);
  });

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, closing server...");
  server.close(() => {
    console.log("👋 Server closed.");
    process.exit(0);
  });
});