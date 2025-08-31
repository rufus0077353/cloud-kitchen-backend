
// index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// ---- DB ----
const db = require("./models"); // includes sequelize instance

// ---- App ----
const app = express();

// Allowed frontend origins (env first, fallback to known hosts)
const DEFAULT_ORIGINS = [
  "https://servezy.in",
  "https://www.servezy.in",
  "https://glistening-taffy-7be8bf.netlify.app",
  "http://localhost:3000",
];
const FRONTENDS = (process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : DEFAULT_ORIGINS
)
  .map((s) => s.trim())
  .filter(Boolean);

// Trust proxy (Render/Heroku/NGINX) so websocket upgrade works well
app.set("trust proxy", 1);

// ---- Middleware ----
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // health checks / curl / same-origin
      return FRONTENDS.includes(origin)
        ? cb(null, true)
        : cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: "Content-Type, Authorization, X-Requested-With, Idempotency-Key",
  })
);

// ✅ Express 5-friendly preflight handler (replaces app.options("*", cors()))
app.options("(.*)", cors());

app.use(express.json());
// ---- HTTP server + Socket.IO ----
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
});

// expose helpers
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

  // Optional: if you emit auth refresh from the client
  socket.on("auth:refresh", () => {
    // no-op placeholder; add token checks here if needed
  });

  socket.on("disconnect", (reason) => {
    console.log("🔌 socket disconnected:", reason);
  });
});

// ---- Routes (safe mounting) ----
const { VAPID_PUBLIC_KEY } = require("./utils/push");

// Required routes (these should exist)
const authRoutes = require("./routes/authRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const menuItemRoutes = require("./routes/menuItemRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const pushRoutes = require("./routes/pushRoutes");

// Optional route: paymentRoutes might not exist yet during first deploys
let paymentRoutes = null;
try {
  // If ./routes/paymentRoutes.js is missing, we'll skip mounting it gracefully
  // eslint-disable-next-line import/no-unresolved, global-require
  paymentRoutes = require("./routes/paymentRoutes");
} catch (e) {
  console.warn("⚠️  paymentRoutes not found — skipping /api/payments mount for now.");
}

// Helper to mount a plain router if it exists
const mountSafe = (path, router) => {
  if (router && typeof router === "function") {
    app.use(path, router);
  } else {
    console.warn(`⚠️  Skipped mounting ${path} — handler not a function.`);
  }
};

// Helper to mount a router with emit helpers injected (orders/payments)
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

// Mount required
mountSafe("/api/auth", authRoutes);
mountSafe("/api/vendors", vendorRoutes);
mountSafe("/api/menu-items", menuItemRoutes);
mountWithEmit("/api/orders", orderRoutes);
mountSafe("/api/push", pushRoutes);
mountSafe("/api/admin", adminRoutes);

// Mount optional payments, only if present
if (paymentRoutes) {
  mountWithEmit("/api/payments", paymentRoutes);
}

// Public key endpoint used by the frontend
app.get("/public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || "" });
});

// Health & root
app.get("/ping", (_req, res) => res.send("pong"));
app.get("/", (_req, res) => res.send("✅ Cloud Kitchen Backend is live!"));

// 404 fallback
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// ---- Start ----
const PORT = process.env.PORT || 5000;

db.sequelize
  .sync({ alter: true })
  .then(async () => {
    console.log("✅ DB synced successfully");
    try {
      const tables = await db.sequelize.getQueryInterface().showAllTables();
      console.log("🧩 Tables in DB:", tables);
    } catch {
      // ignore
    }
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

// Optional graceful shutdown on Render
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, closing server...");
  server.close(() => {
    console.log("👋 Server closed.");
    process.exit(0);
  });
});