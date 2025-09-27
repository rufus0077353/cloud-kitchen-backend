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
const { DataTypes } = require("sequelize");

// ---- App ----
const app = express();

/* =========================
   Allowed frontend origins
   ========================= */
const DEFAULT_ORIGINS = [
  "https://servezy.in",
  "https://www.servezy.in",
  "https://glistening-taffy-7be8bf.netlify.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

const FRONTENDS_LIST = (process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : DEFAULT_ORIGINS)
  .map((s) => s.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (FRONTENDS_LIST.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith(".netlify.app")) return true;
    if (u.hostname === "localhost") return true;
  } catch {}
  return false;
};

const corsConfig = {
  origin: (origin, cb) => (isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key"],
};

/* =========================
   Proxies & core middleware
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
   Rate limits
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
    skip: (req) => req.method === "OPTIONS",
  })
);

/* =========================
   HTTP server + Socket.IO
   ========================= */
const server = http.createServer(app);

const io = new Server(server, {
  path: "/socket.io",
  cors: corsConfig,
  pingInterval: 25000,
  pingTimeout: 60000,
  allowEIO3: true,
});

const emitToVendor = (vendorId, event, payload) => vendorId && io.to(`vendor:${vendorId}`).emit(event, payload);
const emitToUser = (userId, event, payload) => userId && io.to(`user:${userId}`).emit(event, payload);

app.set("io", io);
app.set("emitToVendor", emitToVendor);
app.set("emitToUser", emitToUser);

io.on("connection", (socket) => {
  console.log("🔌 socket connected", socket.id);
  socket.emit("connected", { id: socket.id });

  socket.on("vendor:join", (vendorId) => vendorId && socket.join(`vendor:${vendorId}`));
  socket.on("user:join", (userId) => userId && socket.join(`user:${userId}`));

  socket.on("disconnect", (reason) => {
    console.log("🔌 socket disconnected:", reason);
  });
});

/* =========================
   Routes
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
    ? app.use(
        p,
        (req, _res, next) => {
          req.emitToVendor = emitToVendor;
          req.emitToUser = emitToUser;
          next();
        },
        r
      )
    : console.warn(`⚠️  Skipped mounting ${p}`);

mountSafe("/api/auth", authRoutes);
mountSafe("/api/vendors", vendorRoutes);
mountSafe("/api/menu-items", menuItemRoutes);
mountWithEmit("/api/orders", orderRoutes);
mountSafe("/api/push", pushRoutes);
mountSafe("/api/admin", adminRoutes);
mountSafe("/api/uploads", uploadRoutes);
mountSafe("/api/admin-cleanup", adminCleanupRoutes);
if (paymentsRouter) mountWithEmit("/api/payments", paymentsRouter);

app.get("/public-key", (_req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY || "" }));

// Health
app.get("/ping", (_req, res) => res.send("pong"));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.send("✅ Cloud Kitchen Backend is live!"));

// 404 fallback
app.use((req, res) => res.status(404).json({ message: "Route not found" }));
app.use("/api/debug", debugRoutes);

// Global error handler
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err.message || err);
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked" });
  }
  res.status(500).json({ message: "Server error" });
});

/* =========================
   Start + DB Fix
   ========================= */
async function ensureVendorTimestamps() {
  const qi = db.sequelize.getQueryInterface();
  let table;
  try {
    table = await qi.describeTable("vendors");
  } catch {
    return;
  }

  if (!table.createdAt) {
    console.log('[db] Adding "createdAt" to vendors with default NOW()');
    await qi.addColumn("vendors", "createdAt", {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: db.sequelize.literal("CURRENT_TIMESTAMP"),
    });
  }

  if (!table.updatedAt) {
    console.log('[db] Adding "updatedAt" to vendors with default NOW()');
    await qi.addColumn("vendors", "updatedAt", {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: db.sequelize.literal("CURRENT_TIMESTAMP"),
    });
  }
}

const PORT = process.env.PORT || 5000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

db.sequelize
  .authenticate()
  .then(async () => {
    await ensureVendorTimestamps();

    // sync only in dev
    if (process.env.NODE_ENV !== "production") {
      await db.sequelize.sync({ alter: true });
      console.log("✅ DB synced successfully (dev only)");
    } else {
      console.log("⏭️  Skipping sequelize.sync in production");
    }

    server.listen(PORT, () => {
      console.log(`🚀 Server (HTTP + Socket.IO) listening on port ${PORT}`);
      console.log("🌐 Allowed origins:", FRONTENDS_LIST.join(", "), " + *.netlify.app + localhost");
      console.log("✅ Connecting to database:", process.env.DB_NAME);
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