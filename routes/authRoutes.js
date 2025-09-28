
// routes/authRoutes.js
const express = require("express");
const jwt = require("jsonwebtoken");

// Pull models and the sequelize instance from your central models index
const { User, Vendor, sequelize } = require("../models");

const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "nani@143";

/* ------------------------- Health ------------------------- */
router.get("/ping", (_req, res) => res.send("pong"));

/* ------------------------- Register ----------------------- */
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  let { role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email and password are required" });
  }

  // normalize & default
  role = String(role || "user").toLowerCase();

  // do everything in one transaction so we don't end up with a User without Vendor
  const t = await sequelize.transaction();
  try {
    const existingUser = await User.findOne({ where: { email }, transaction: t });
    if (existingUser) {
      await t.rollback();
      return res.status(409).json({ message: "User already registered" });
    }

    // password gets hashed by User.beforeSave hook
    const newUser = await User.create({ name, email, password, role }, { transaction: t });

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

    const token = jwt.sign({ userId: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: "7d" });

    return res.status(201).json({
      message: "User registered",
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
      vendor: vendor
        ? {
            id: vendor.id,
            name: vendor.name,
            UserId: vendor.UserId,
          }
        : null,
    });
  } catch (err) {
    await t.rollback();
    console.error("❌ Registration failed:", err);
    return res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

/* -------- Admin creates Vendor/Admin (no auto vendor here) -------- */
router.post("/admin/register", authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "All fields including role are required" });
  }

  const normalizedRole = String(role).toLowerCase();

  const t = await sequelize.transaction();
  try {
    const existingUser = await User.findOne({ where: { email }, transaction: t });
    if (existingUser) {
      await t.rollback();
      return res.status(409).json({ message: "User already exists" });
    }

    const newUser = await User.create(
      { name, email, password, role: normalizedRole },
      { transaction: t }
    );

    // Optional: if admins want to instantly provision a Vendor when they create a vendor user:
    let vendor = null;
    if (normalizedRole === "vendor") {
      vendor = await Vendor.create(
        { UserId: newUser.id, name: `${newUser.name}'s Vendor`, location: "TBD", isOpen: true },
        { transaction: t }
      );
    }

    await t.commit();

    res.status(201).json({
      message: `${normalizedRole} created successfully`,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
      vendor: vendor ? { id: vendor.id, name: vendor.name, UserId: vendor.UserId } : null,
    });
  } catch (err) {
    await t.rollback();
    console.error("❌ Admin registration failed:", err);
    res.status(500).json({ message: "Admin registration failed", error: err.message });
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

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
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
    const user = await User.findByPk(req.user.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name;
    if (email) user.email = email;
    if (password) user.password = password; // will re-hash via beforeSave

    await user.save();

    res.json({
      message: "Profile updated",
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("❌ Update failed:", err);
    res.status(500).json({ message: "Update failed", error: err.message });
  }
});

/* ------------------------ Token Check --------------------- */
router.get("/check", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId);
    res.json({ message: "Token valid", user });
  } catch (err) {
    console.error("❌ Token check failed:", err);
    res.status(500).json({ message: "Token check failed", error: err.message });
  }
});

module.exports = router;