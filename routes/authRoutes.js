
const express = require("express");
const jwt = require("jsonwebtoken");
const { User } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "nani@143";

// 🟢 Health Check
router.get("/ping", (req, res) => res.send("pong"));

// 🟢 Register User
router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email and password are required" });
  }

  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: "User already registered" });
    }

    const newUser = await User.create({
      name,
      email,
      password,  // Will be hashed by beforeSave
      role: role || "user",
    });

    const token = jwt.sign({ userId: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({
      message: "User registered",
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    console.error("❌ Registration failed:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

// 🟢 Admin creates Vendor/Admin
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

// 🟢 Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(401).json({ message: "Invalid email or password" });

    const isValid = await user.validPassword(password);
    if (!isValid) return res.status(401).json({ message: "Invalid email or password" });

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

// 🟢 Update Profile
router.put("/update", authenticateToken, async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const user = await User.findByPk(req.user.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name;
    if (email) user.email = email;
    if (password) user.password = password; // Will be hashed by beforeSave

    await user.save();

    res.json({
      message: "Profile updated",
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: "Update failed", error: err.message });
  }
});

// 🟢 Token check (Admin only)
router.get("/check", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId);
    res.json({ message: "Token valid", user });
  } catch (err) {
    res.status(500).json({ message: "Token check failed", error: err.message });
  }
});

module.exports = router;