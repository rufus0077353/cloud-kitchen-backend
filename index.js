require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const sequelize = require('./db');

console.log("✅ Connecting to database:", process.env.DB_NAME);

const app = express();

const db = require("./models");
const authRoutes = require("./routes/authRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const menuItemRoutes = require("./routes/menuItemRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");

// ✅ CORS fix for PATCH + Authorization
const FRONTENDS = ["https://servezy.in", "https://glistening-taffy-7be8bf.netlify.app, http://localhost:3000"];

app.use(cors({
  origin: FRONTENDS,
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS", // include PATCH
  allowedHeaders: "Content-Type, Authorization, X-Requested-With"
}));

app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: FRONTENDS,
    methods: ["GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS"],
    credentials: true,
  },
});

app.set("io", io);

// Basic vendor room joining
io.on("connection", (socket) => {
  // client should send vendorId after login
  socket.on("vendor:join", (vendorId) => {
    if (!vendorId) return;
    socket.join(`vendor:${vendorId}`);
  });

  socket.on("disconnect", () => {});
});

console.log("✅ Registering auth routes");
app.use("/api/auth", authRoutes);

console.log("✅ Registering vendor routes");
app.use("/api/vendors", vendorRoutes);

console.log("✅ Registering menu item routes");
app.use("/api/menu-items", menuItemRoutes);

console.log("✅ Registering order routes");
app.use("/api/orders", orderRoutes);

console.log("✅ Registering admin routes");
app.use("/api/admin", adminRoutes);

app.get("/ping", (req, res) => {
  res.send("pong");
});

app.get('/', (req, res) => {
  res.send('✅ Cloud Kitchen Backend is live!');
});

// 404 fallback handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const PORT = process.env.PORT || 5000;

db.sequelize.sync({ alter : true }).then(() => {
 console.log("✅ DB synced successfully");

 // Check the tables created
 db.sequelize.getQueryInterface().showAllTables()
   .then(tables => {
     console.log("🧩 Tables in DB:", tables);
   });

 app.listen(PORT, () => {
   console.log(`🚀 Server is running on port ${PORT}`);
 });
}).catch(err => {
 console.error("❌ DB sync failed:", err);
});