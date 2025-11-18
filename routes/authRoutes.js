// routes/authRoutes.js
const express = require("express");
const jwt = require("jsonwebtoken");
const { User, Vendor, sequelize } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "servezy-secret";

/* ------------------------- Health ------------------------- */
router.get("/ping", (_req, res) => res.send("pong"));

/* ------------------------- Register ----------------------- */
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  let { role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required" });
  }

  role = String(role || "user").toLowerCase();

  const t = await sequelize.transaction();
  try {
    const existingUser = await User.findOne({ where: { email }, transaction: t });
    if (existingUser) {
      await t.rollback();
      return res.status(409).json({ message: "User already registered" });
    }

    const newUser = await User.create(
      { name, email, password, role, emailVerified: true },   //  ⬅ emailVerified always true
      { transaction: t }
    );

    let vendor = null;
    if (role === "vendor") {
      vendor = await Vendor.create(
        {
          UserId: newUser.id,
          name: `${newUser.name}'s Vendor`,
          location: "TBD",
          cuisine: null,
          phone: null,
          logoUrl: null,
          isOpen: true,
          isDeleted: false,
        },
        { transaction: t }
      );
    }

    await t.commit();

    const token = jwt.sign({ userId: newUser.id, role: newUser.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        emailVerified: true,
      },
      vendor: vendor ? { id: vendor.id, name: vendor.name } : null,
    });
  } catch (err) {
    await t.rollback();
    console.error("❌ Registration failed:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

/* --------------------------- Login ------------------------ */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(401).json({ message: "Invalid email or password" });

    const isValid = await user.validPassword(password);
    if (!isValid) return res.status(401).json({ message: "Invalid email or password" });

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: true,
      }
    });
  } catch (err) {
    console.error("❌ Login failed:", err);
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

/* ----------------------- Update Profile ------------------- */
router.put("/update", authenticateToken, async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name;
    if (email) user.email = email;
    if (password) user.password = password;

    await user.save();
    res.json({
      message: "Profile updated",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: true,
      },
    });
  } catch (err) {
    console.error("❌ Update failed:", err);
    res.status(500).json({ message: "Update failed", error: err.message });
  }
});

/* ----------------------- /auth/me -------------------------- */
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.id || req.user.userId);
    const user = await User.findByPk(userId, {
      attributes: ["id", "name", "email", "role"],
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const role = String(user.role).toLowerCase();
    let vendor = null;

    if (role === "vendor") {
      vendor = await Vendor.findOne({
        where: { UserId: user.id },
        attributes: ["id", "name", "location", "isOpen", "isDeleted"],
      });

      if (!vendor) {
        vendor = await Vendor.create({
          UserId: user.id,
          name: `Vendor ${user.id}`,
          location: "TBD",
          isOpen: true,
          isDeleted: false,
        });
      }
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: true,
      vendor,
    });
  } catch (err) {
    console.error("❌ /auth/me failed:", err);
    return res.status(500).json({ message: "Internal error" });
  }
});

/* ----------------------- Debug ---------------------------- */
router.get("/debug/version", (_req, res) => {
  res.json({ file: __filename, now: new Date().toISOString() });
});

module.exports = router;