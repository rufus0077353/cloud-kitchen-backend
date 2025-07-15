
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const router = express.Router();
const { User } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");

const JWT_SECRET = process.env.JWT_SECRET || "nani@143";

// 🔄 Health Check
router.get("/ping", (req, res) => {
  console.log("✅ /api/auth/ping route hit");
  res.send("pong");
});

// 🧾 Register User
router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  console.log("🔐 Incoming registration request", req.body);

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: "User already registered" });
    }

    const newUser = await User.create({ name, email, password, role });
    const token = jwt.sign({ userId: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: "1h" });

    res.status(201).json({
      message: "User registered",
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (err) {
    console.error("❌ Registration failed:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

// 🛡 Admin creates Admin or Vendor
router.post("/admin/register", authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "All fields including role are required" });
  }

  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const newUser = await User.create({ name, email, password, role });
    res.status(201).json({
      message: `${role} created successfully`,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    res.status(500).json({ message: "Admin registration failed", error: err.message });
  }
});

// 🔓 Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ where: { email } });
    if (!user || !(await user.validPassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "1h" });

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

// ✏️ Update Profile
router.put("/update", authenticateToken, async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const user = await User.findByPk(req.user.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.name = name || user.name;
    user.email = email || user.email;
    if (password) user.password = password;

    await user.save();

    res.json({
      message: "Profile updated",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Update failed", error: err.message });
  }
});

// ✅ Validate Token (Admin only)
router.get("/check", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId);
    res.json({ message: "Token valid", user });
  } catch (err) {
    res.status(500).json({ message: "Token check failed", error: err.message });
  }
});

module.exports = router;