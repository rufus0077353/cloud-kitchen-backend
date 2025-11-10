
// index.js
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
const { DataTypes } = require("sequelize");
const db = require("./models");

const app = express();

/* =========================
   CORS CONFIGURATION
========================= */
const DEFAULT_ORIGINS = [
  "https://servezy.in",
  "https://www.servezy.in",
  "https://glistening-taffy-7be8bf.netlify.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

const FRONTENDS_LIST = (process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : DEFAULT_ORIGINS)
  .map((s) => s.trim())
  .filter(Boolean);

const DEV_ALLOW_ALL =
  String(process.env.DEV_ALLOW_ALL_CORS || "").toLowerCase() === "true";

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // some clients send no origin
  if (DEV_ALLOW_ALL) return true;
  if (FRONTENDS_LIST.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith(".netlify.app")) return true;
    if (u.hostname === "localhost") return true;
  } catch {}
  return false;
};

const corsConfig = {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) cb(null, true);
    else cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key"],
};

/* =========================
   CORE MIDDLEWARE
========================= */
app.set("trust proxy", 1);
app.use(cors(corsConfig));
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

/* =========================
   RATE LIMITS
========================= */
app.use(
  "/api/",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 800,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
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

/* =========================
   SOCKET.IO CONFIG
========================= */
const server = http.createServer(app);
const io = new Server(server, {
  path: "/socket.io",
  cors: corsConfig,
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  cookie: false,
  pingTimeout: 60000,
  allowEIO3: true,
});

const emitToVendor = (vendorId, event, payload) =>
  vendorId && io.to(`vendor:${vendorId}`).emit(event, payload);

const emitToUser = (userId, event, payload) =>
  userId && io.to(`user:${userId}`).emit(event, payload);

app.set("io", io);
app.set("emitToVendor", emitToVendor);
app.set("emitToUser", emitToUser);

io.on("connection", (socket) => {
  console.log("🔌 socket connected", socket.id);
  socket.emit("connected", { id: socket.id });

  socket.on("vendor:join", (vendorId) => vendorId && socket.join(`vendor:${vendorId}`));
  socket.on("user:join", (userId) => userId && socket.join(`user:${userId}`));
  socket.on("disconnect", (reason) => console.log("🔌 socket disconnected:", reason));
});

/* =========================
   ROUTE IMPORTS
========================= */
const { VAPID_PUBLIC_KEY } = require("./utils/push");

const authRoutes = require("./routes/authRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const menuItemRoutes = require("./routes/menuItemRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const pushRoutes = require("./routes/pushRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const adminCleanupRoutes = require("./routes/adminCleanupRoutes");
const debugRoutes = require("./routes/debugRoutes");
const menuItemsBulkRoutes = require("./routes/menuItemsBulkRoutes");
const otpRoutes = require("./routes/otpRoutes");
const emailConfirmRoutes = require("./routes/emailConfirmRoutes");
const marketingRoutes = require("./routes/marketingRoutes");
const devEmailRoutes = require("./routes/devEmail");

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

/* =========================
   ROUTE MOUNTS
========================= */
const describeRouter = (r) => {
  try {
    const stack = r?.stack || r?.handle?.stack || [];
    return stack
      .filter((l) => l && l.route && l.route.path)
      .map((l) => ({
        path: l.route.path,
        methods: Object.keys(l.route.methods).map((m) => m.toUpperCase()),
      }));
  } catch {
    return [];
  }
};

const mountSafe = (basePath, router) => {
  if (router && typeof router === "function") {
    app.use(basePath, router);
    const list = describeRouter(router);
    console.log(`[routes] mounted ${basePath} -> ${list.length} subroutes`);
  } else {
    console.warn(`⚠️  Skipped mounting ${basePath}`);
  }
};

const mountWithEmit = (basePath, router) => {
  if (router && typeof router === "function") {
    app.use(
      basePath,
      (req, _res, next) => {
        req.emitToVendor = emitToVendor;
        req.emitToUser = emitToUser;
        next();
      },
      router
    );
    const list = describeRouter(router);
    console.log(`[routes] mounted ${basePath} (with emit) -> ${list.length} subroutes`);
  } else {
    console.warn(`⚠️  Skipped mounting ${basePath}`);
  }
};

// ✅ Final route mounts (clean)
mountSafe("/api/auth", authRoutes);
mountSafe("/api/vendors", vendorRoutes);
mountSafe("/api/menu-items", menuItemRoutes);
mountWithEmit("/api/orders", orderRoutes);
mountSafe("/api/push", pushRoutes);
mountSafe("/api/admin", adminRoutes);
mountSafe("/api/uploads", uploadRoutes);
mountSafe("/api/admin-cleanup", adminCleanupRoutes);
mountSafe("/api/menu-items", menuItemsBulkRoutes);
mountSafe("/api/otp", otpRoutes);
mountSafe("/api/", emailConfirmRoutes);
mountSafe("./api/marketing", marketingRoutes);
mountSafe("./api/dev-email", devEmailRoutes)
if (paymentsRouter) mountWithEmit("/api/payments", paymentsRouter);

/* =========================
   HEALTH + DEBUG
========================= */
app.get("/public-key", (_req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY || "" }));
app.get("/ping", (_req, res) => res.send("pong"));

// Add both names so curl tests & uptime pings work everywhere
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/api/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/", (_req, res) => res.send("✅ Cloud Kitchen Backend is live!"));
app.use("/api/debug", debugRoutes);

/* =========================
   404 + ERROR HANDLERS
========================= */
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err.message || err);
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked" });
  }
  res.status(500).json({ message: "Server error" });
});

/* =========================
   DB INITIALIZATION
========================= */
async function ensureTimestamps(tableName) {
  const qi = db.sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable(tableName);
    if (!desc.createdAt) {
      console.log(`[db] Adding createdAt to ${tableName}`);
      await qi.addColumn(tableName, "createdAt", {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: db.sequelize.literal("CURRENT_TIMESTAMP"),
      });
    }
    if (!desc.updatedAt) {
      console.log(`[db] Adding updatedAt to ${tableName}`);
      await qi.addColumn(tableName, "updatedAt", {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: db.sequelize.literal("CURRENT_TIMESTAMP"),
      });
    }
  } catch {
    console.warn(`[db] Skipped ensureTimestamps for ${tableName}`);
  }
}

/* =========================
   SERVER STARTUP
========================= */
const PORT = process.env.PORT || 5000;
// On Windows, binding to 127.0.0.1 avoids localhost/0.0.0.0 quirks.
// You can override with HOST in .env (e.g., HOST=0.0.0.0 for Docker/Render).
const HOST =
  process.env.HOST ||
  (process.platform === "win32" ? "127.0.0.1" : "0.0.0.0");

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

db.sequelize
  .authenticate()
  .then(async () => {
    await ensureTimestamps("Users");
    await ensureTimestamps("Vendors");

    if (process.env.NODE_ENV !== "production" && process.env.ALLOW_SYNC_DEV === "true") {
      await db.sequelize.sync();
      console.log("✅ DB synced (dev mode)");
    } else {
      console.log("⏭️  Skipping DB sync (using migrations)");
    }

    server.listen(PORT, HOST, () => {
      console.log(`🚀 Server running at http://${HOST}:${PORT}`);
      console.log(
        "🌐 Allowed origins:",
        DEV_ALLOW_ALL
          ? "ALL (DEV_ALLOW_ALL_CORS=true)"
          : FRONTENDS_LIST.join(", ") + " + *.netlify.app + localhost"
      );
    });
  })
  .catch((err) => {
    console.error("❌ DB startup failed:", err);
    process.exit(1);
  });

process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, closing server...");
  server.close(() => {
    console.log("👋 Server closed.");
    process.exit(0);
  });
});