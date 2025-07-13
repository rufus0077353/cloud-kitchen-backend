const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const router = express.Router();
const { User } = require("../models");
const { authenticateToken, requireAdmin} = require("../middleware/authMiddleware");


const JWT_SECRET = process.env.JWT_SECRET || "nani@143";

// Health check
router.get("/ping", (req, res) => {
  console.log("✅ /api/auth/ping route hit");
  res.send("pong");
});

// Register
router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  console.log("🔐 Incoming registration request", req.body);

  if (!name || !email || !password || !role) {
    console.log("❌ Missing required fields");
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      console.log("⚠️ User already exists:", email);
      return res.status(409).json({ message: "User already registered" });
    }

    const newUser = await User.create({ name, email, password, role });

    const token = jwt.sign({ userId: newUser.id }, process.env.JWT_SECRET, { expiresIn: "1h" });

    console.log("✅ User created:", newUser);

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
    res.status(500).json({ message: "Internal Server Error", error: err.message });
  }
});

// 🛡️ PROTECTED: Admin-only route to register new admin or vendor users
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
    res.status(201).json({ message: `${role} user created`, user: newUser });
  } catch (err) {
    res.status(500).json({ message: "Admin registration error", error: err.message });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ where: { email } });

    if (!user || !(await user.validPassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1h" });

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ message: "Login error", error: err.message });
  }
});



// PUT /api/auth/update
router.put("/update", authenticateToken, async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.name = name;
    user.email = email;
    if (password) user.password = password;

    await user.save();

    res.json({
      message: "User updated",
      updatedUser: {
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




// ...your /register and/login routes above...

// Protected route added at the bottom
router.get("/check", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId);
    res.json({ message: "Token is valid", });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
