require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const morgan = require("morgan");

// ---- DB ----
const db = require("./models");

// ---- App ----
const app = express();

// Allowed frontend origins (env first, fallback to known hosts)
const DEFAULT_ORIGINS = [
  "https://servezy.in",
  "https://www.servezy.in",
  "https://glistening-taffy-7be8bf.netlify.app",
  "http://localhost:3000",
];
const FRONTENDS = (process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : DEFAULT_ORIGINS)
  .map((s) => s.trim())
  .filter(Boolean);

// Trust proxy (Render/Heroku/NGINX) so websocket upgrade works well
app.set("trust proxy", 1);

// ---- Security & Middleware ----
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // health checks / curl / same-origin
      return FRONTENDS.includes(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"));
    },
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

// Rate limits
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

// ---- HTTP server + Socket.IO (single instance) ----
const server = http.createServer(app);
const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: FRONTENDS,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 60000,
  allowEIO3: true,
});

// socket helpers exposed to routes
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

// Rooms
io.on("connection", (socket) => {
  console.log("🔌 socket connected", socket.id);

  socket.on("vendor:join", (vendorId) => vendorId && socket.join(`vendor:${vendorId}`));
  socket.on("user:join", (userId) => userId && socket.join(`user:${userId}`));

  socket.on("auth:refresh", () => {
    // add token checks here if needed
  });

  socket.on("disconnect", (reason) => {
    console.log("🔌 socket disconnected:", reason);
  });
});

// ---- Routes ----
const { VAPID_PUBLIC_KEY } = require("./utils/push");

const authRoutes = require("./routes/authRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const menuItemRoutes = require("./routes/menuItemRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const pushRoutes = require("./routes/pushRoutes");

// Optional payments router: support either file name
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

const mountSafe = (path, router) => {
  if (router && typeof router === "function") {
    app.use(path, router);
  } else {
    console.warn(`⚠️  Skipped mounting ${path} — handler not a function.`);
  }
};
const mountWithEmit = (path, router) => {
  if (router && typeof router === "function") {
    app.use(
      path,
      (req, _res, next) => {
        req.emitToVendor = emitToVendor;
        req.emitToUser = emitToUser;
        next();
      },
      router
    );
  } else {
    console.warn(`⚠️  Skipped mounting ${path} — handler not a function.`);
  }
};

mountSafe("/api/auth", authRoutes);
mountSafe("/api/vendors", vendorRoutes);
mountSafe("/api/menu-items", menuItemRoutes);
mountWithEmit("/api/orders", orderRoutes);
mountSafe("/api/push", pushRoutes);
mountSafe("/api/admin", adminRoutes);
if (paymentsRouter) mountWithEmit("/api/payments", paymentsRouter); // mount once

// Public key endpoint
app.get("/public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || "" });
});

// Health & root
app.get("/ping", (_req, res) => res.send("pong"));
app.get("/", (_req, res) => res.send("✅ Cloud Kitchen Backend is live!"));

// 404 fallback (after all routes)
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
      console.log("🌐 Allowed origins:", FRONTENDS.join(", "));
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