
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
const bcrypt = require("bcryptjs");

const db = require("./models");
const { DataTypes } = require("sequelize");
const resolvedAuthPath =require.resolve("./routes/authRoutes");
console.log("[mount] authRoutes file:", resolvedAuthPath);

const app = express();

/* =========================
   CORS
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

// During local debugging you can set DEV_ALLOW_ALL_CORS=true to allow everything
const DEV_ALLOW_ALL = String(process.env.DEV_ALLOW_ALL_CORS || "").toLowerCase() === "true";

const isAllowedOrigin = (origin) => {
  if (!origin) return true;              // RN/Expo often sends no Origin header
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
  origin: (origin, cb) => (isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key"],
};

/* =========================
   Core middleware
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
const emitToUser   = (userId, event, payload)   => userId && io.to(`user:${userId}`).emit(event, payload);

app.set("io", io);
app.set("emitToVendor", emitToVendor);
app.set("emitToUser", emitToUser);

io.on("connection", (socket) => {
  console.log("🔌 socket connected", socket.id);
  socket.emit("connected", { id: socket.id });
  socket.on("vendor:join", (vendorId) => vendorId && socket.join(`vendor:${vendorId}`));
  socket.on("user:join",   (userId)   => userId && socket.join(`user:${userId}`));
  socket.on("disconnect", (reason) => console.log("🔌 socket disconnected:", reason));
});

/* =========================
   Routes
   ========================= */
const { VAPID_PUBLIC_KEY } = require("./utils/push");

const authRoutes          = require("./routes/authRoutes");
console.log("[debug] Loaded authRoutes", typeof authRoutes);
const vendorRoutes        = require("./routes/vendorRoutes");
const menuItemRoutes      = require("./routes/menuItemRoutes");
const orderRoutes         = require("./routes/orderRoutes");
const adminRoutes         = require("./routes/adminRoutes");
const pushRoutes          = require("./routes/pushRoutes");
const uploadRoutes        = require("./routes/uploadRoutes");
const adminCleanupRoutes  = require("./routes/adminCleanupRoutes");
const debugRoutes         = require("./routes/debugRoutes");

let paymentsRouter = null;
try { paymentsRouter = require("./routes/payments"); }
catch {
  try { paymentsRouter = require("./routes/paymentRoutes"); }
  catch { console.warn("⚠️  payments router not found — skipping /api/payments"); }
}

// ===================================================
// Enhanced mount helpers (with route logging)
// ===================================================
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
    list.forEach((r) => console.log(`  ${basePath}${r.path}  [${r.methods.join(", ")}]`));
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
    list.forEach((r) => console.log(`  ${basePath}${r.path}  [${r.methods.join(", ")}]`));
  } else {
    console.warn(`⚠️  Skipped mounting ${basePath}`);
  }
};

mountSafe("/api/auth",        authRoutes);
mountSafe("/api/vendors",     vendorRoutes);
mountSafe("/api/menu-items",  menuItemRoutes);
mountWithEmit("/api/orders",  orderRoutes);
mountSafe("/api/push",        pushRoutes);
mountSafe("/api/admin",       adminRoutes);
mountSafe("/api/uploads",     uploadRoutes);
mountSafe("/api/admin-cleanup", adminCleanupRoutes);
if (paymentsRouter) mountWithEmit("/api/payments", paymentsRouter);

app.get("/public-key", (_req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY || "" }));

// Health & debug
app.get("/ping", (_req, res) => res.send("pong"));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/api/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/", (_req, res) => res.send("✅ Cloud Kitchen Backend is live!"));


// ===== DEBUG (keep before 404) =====
app.use("/api/debug", debugRoutes);

// ===== DEBUG route inspector (Express 4/5 compatible) =====

// --- DEBUG: quick version + uptime (confirms you’re on the code you expect)
app.get("/api/debug/version", (_req, res) => {
  res.json({
    startedAt: new Date(process.uptime() * -1000 + Date.now()).toISOString(),
    now: new Date().toISOString(),
    node: process.version,
    pid: process.pid,
    routesMounted: true,
  });
});

// --- DEBUG: precise check for /api/auth/me being mounted
app.get("/api/debug/has-auth-me", (req, res) => {
  try {
    const found = [];

    const walk = (stack, base = "") => {
      if (!Array.isArray(stack)) return;
      for (const layer of stack) {
        if (!layer) continue;

        // concrete route (e.g. router.get('/me', ...))
        if (layer.route && layer.route.path) {
          const p = base + layer.route.path;
          const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
          if (p === "/api/auth/me") {
            found.push({ path: p, methods });
          }
        }

        // nested router (mounted with app.use('/api/auth', router))
        if (layer.handle && Array.isArray(layer.handle.stack)) {
          // try to recover the mount path from the regexp in Express' layer
          let mount = "";
          const src = layer.regexp && layer.regexp.toString(); // e.g. /^\/api\/auth\/?(?=\/|$)/i
          if (src) {
            // very lenient: pull out "/api/auth" from the regex string
            const match = src.match(/^\s*\/\^\\(\/.+?)\\\/\?\(\?=\\\/\|\$\)\/i?$/) || src.match(/^\s*\/\^\\(\/.+?)\\\/\?/);
            if (match && match[1]) {
              mount = match[1].replace(/\\\//g, "/"); // unescape slashes
            }
          }
          walk(layer.handle.stack, base + mount);
        }
      }
    };

    if (app._router && Array.isArray(app._router.stack)) {
      walk(app._router.stack, "");
    }

    res.json({ hasAuthMe: found.length > 0, matches: found });
  } catch (e) {
    console.error("has-auth-me inspector failed:", e);
    res.status(500).json({ message: "inspector failed", error: e.message });
  }
});

// ===== DEBUG route inspector (Express 4/5 hardened) =====
app.get("/api/debug/routes", (req, res) => {
  try {
    const routes = [];

    // Safely convert a layer regexp to a readable path prefix
    const layerPrefix = (layer) => {
      if (!layer || !layer.regexp) return "";
      let src = layer.regexp.source || "";
      // Common express-toString cleanups
      src = src
        .replace(/^\^\\\//, "/")          // ^\/ -> /
        .replace(/\\\/\?\(\?=\\\/\|\$\)\$$/, "") // optional trailing slash group
        .replace(/\\\//g, "/")            // \/ -> /
        .replace(/\^\?/, "")
        .replace(/\$$/, "");
      if (src === "(?:^/)?") return "/";
      return src;
    };

    const scan = (stack, base = "") => {
      if (!Array.isArray(stack)) return;

      for (const layer of stack) {
        if (!layer) continue;

        // Direct route
        if (layer.route && layer.route.path) {
          const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase());
          routes.push({
            path: base + layer.route.path,
            methods: methods.length ? methods : ["<ALL>"],
          });
          continue;
        }

        // Mounted router or middleware that wraps another stack
        const child = layer.handle && Array.isArray(layer.handle.stack) ? layer.handle.stack : null;
        if (child) {
          const prefix = layerPrefix(layer);
          scan(child, base + prefix);
        }
      }
    };

    const root = app && app._router && app._router.stack;
    scan(root, "");

    // Quick diagnostics (visible in server logs)
    console.log("[route-inspector] layers:", Array.isArray(root) ? root.length : "n/a",
                "found routes:", routes.length);

    res.json({ count: routes.length, routes });
  } catch (err) {
    console.error("❌ Route listing failed:", err);
    res.status(500).json({ message: "Failed to list routes", error: err.message });
  }
});

// mount after inspector
app.use("/api/debug", debugRoutes);

app.get("/api/debug/list-users", async (_req, res) => {
  try {
    const rows = await db.User.findAll({
      limit: 20,
      order: [["id", "ASC"]],
      attributes: ["id", "name", "email", "role", "createdAt"],
    });
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    console.error("debug list-users error:", err);
    res.status(500).json({ message: "List failed", error: err.message });
  }
});

app.get("/api/debug/check-user", async (req, res) => {
  try {
    const { email, password } = req.query;
    if (!email) return res.status(400).json({ message: "Email required" });

    const user = await db.User.findOne({ where: { email } });
    if (!user) return res.json({ found: false, message: "User not found" });

    let passwordMatch = undefined;
    if (password) passwordMatch = await bcrypt.compare(password, user.password);

    res.json({
      found: true,
      id: user.id,
      email: user.email,
      role: user.role,
      passwordStored: user.password?.startsWith("$2") ? "hashed ✅" : "plain ❌",
      passwordMatch: password ? passwordMatch : "not tested",
    });
  } catch (err) {
    res.status(500).json({ message: "Debug failed", error: err.message });
  }
});

app.post("/api/debug/seed-user", express.json(), async (req, res) => {
  try {
    const { name = "Test", email, password = "Password123", role = "user" } = req.body;
    if (!email) return res.status(400).json({ message: "email required" });

    let user = await db.User.findOne({ where: { email } });
    if (user) return res.json({ created: false, message: "Exists", id: user.id });

    user = await db.User.create({ name, email, password, role });
    res.status(201).json({ created: true, id: user.id, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ message: "Seed failed", error: err.message });
  }
});



// 1) List only the auth router's subroutes (what Express thinks is mounted under /api/auth)
app.get("/api/debug/auth-routes", (_req, res) => {
  try {
    const r = authRoutes;
    const stack = r?.stack || r?.handle?.stack || [];
    const routes = stack
      .filter(l => l?.route?.path)
      .map(l => ({
        path: l.route.path,
        methods: Object.keys(l.route.methods || {}).map(m => m.toUpperCase())
      }));
    res.json({ base: "/api/auth", count: routes.length, routes });
  } catch (e) {
    res.status(500).json({ message: "auth-routes dump failed", error: e.message });
  }
});

// 2) Simple ping on the auth base (proves the /api/auth mount works at all)
app.get("/api/auth/ping", (_req, res) => res.json({ ok: true, where: "/api/auth/ping" }));

// 3) Explicit probe for the exact path (bypasses authenticateToken)
app.get("/api/auth/_probe_me", (_req, res) => res.json({ ok: true, path: "/api/auth/_probe_me" }));

// 4) Log every unmatched request just before the 404 JSON
app.use((req, _res, next) => {
  // this runs only if nothing handled the request above
  console.warn("[404 trace]", req.method, req.originalUrl);
  next();
});
// ===== END DEBUG =====

// ===== TEMP DIRECT /api/auth/me (bypass router) =====
const jwt = require("jsonwebtoken");
const { User, Vendor } = require("./models");
const JWT_SECRET = process.env.JWT_SECRET || "nani@143";

app.get("/api/auth/me", async (req, res) => {
  try {
    const ah = req.headers.authorization || "";
    const token = ah.startsWith("Bearer ") ? ah.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Token missing" });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const uid = Number(decoded.userId ?? decoded.id);
    if (!Number.isFinite(uid)) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    const user = await User.findByPk(uid, {
      attributes: ["id", "name", "email", "role"],
      include: [{ model: Vendor, attributes: ["id", "name", "location", "isOpen"] }],
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      vendorId: user.Vendor ? user.Vendor.id : null,
      vendor: user.Vendor
        ? {
            id: user.Vendor.id,
            name: user.Vendor.name,
            location: user.Vendor.location,
            isOpen: user.Vendor.isOpen,
          }
        : null,
    });
  } catch (err) {
    console.error("TEMP /api/auth/me failed:", err);
    res.status(500).json({ message: "Internal error" });
  }
});
// ===== END TEMP DIRECT /api/auth/me =====

// 404
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// Global error handler
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err.message || err);
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked" });
  }
  res.status(500).json({ message: "Server error" });
});

/* =========================
   Start + DB fix
   ========================= */
async function ensureTimestamps(tableName) {
  const qi = db.sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable(tableName);
  } catch {
    return;
  }
  if (!desc.createdAt) {
    console.log(`[db] Adding "createdAt" to ${tableName} with default NOW()`);
    await qi.addColumn(tableName, "createdAt", {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: db.sequelize.literal("CURRENT_TIMESTAMP"),
    });
  }
  if (!desc.updatedAt) {
    console.log(`[db] Adding "updatedAt" to ${tableName} with default NOW()`);
    await qi.addColumn(tableName, "updatedAt", {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: db.sequelize.literal("CURRENT_TIMESTAMP"),
    });
  }
}

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0"; // ⬅️ important for devices on LAN
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

db.sequelize
  .authenticate()
  .then(async () => {
    await ensureTimestamps("Users");
    await ensureTimestamps("Vendors");

    if (process.env.NODE_ENV !== "production" && process.env.ALLOW_SYNC_DEV === "true") {
      await db.sequelize.sync();
      console.log("✅ DB synced (dev, safe mode)");
    } else {
      console.log("⏭️  Skipping sequelize.sync (migrations-driven)");
    }

    server.listen(PORT, HOST, () => {
      console.log(`🚀 Server (HTTP + Socket.IO) listening on http://${HOST}:${PORT}`);
      console.log("🌐 Allowed origins:", DEV_ALLOW_ALL ? "ALL (DEV_ALLOW_ALL_CORS=true)" : FRONTENDS_LIST.join(", ") + " + *.netlify.app + localhost");
      console.log("✅ DB:", process.env.DB_NAME || process.env.DATABASE_URL || "(env)");
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