require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

const db = require("./models");
const authRoutes = require("./routes/authRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const menuItemRoutes = require("./routes/menuItemRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");

app.use(cors());
app.use(express.json());

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

// 404 fallback handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// ✅ Sync DB and start server
db.sequelize.sync()
  .then(() =>  console.log("✅ DB synced"))
  .catch((err) => console.error("❌ DB error:", err));