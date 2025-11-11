
// routes/authRoutes.js
const express = require("express");
const jwt = require("jsonwebtoken");
const { User, Vendor, sequelize } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");
const { sendConfirmEmail } = require("../services/emailConfirm");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "nani@143";

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

    // NOTE: password hashing assumed in model hook (User.beforeCreate). If not, add hashing here.
    const newUser = await User.create({ name, email, password, role, emailVerified: false }, { transaction: t });

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

    // Fire & forget email verification so response is fast
    Promise.resolve(sendConfirmEmail(newUser)).catch((err) =>
      console.error("[register] sendConfirmEmail failed:", err.message)
    );

    res.status(201).json({
      message: "User registered. Please verify your email.",
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        emailVerified: !!newUser.emailVerified,
      },
      emailVerification: "sent",
      vendor: vendor ? { id: vendor.id, name: vendor.name, UserId: vendor.UserId } : null,
    });
  } catch (err) {
    await t.rollback();
    console.error("❌ Registration failed:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

/* --------------- Resend verification email ---------------- */
router.post("/email/resend", authenticateToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.emailVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }

    Promise.resolve(sendConfirmEmail(user)).catch((err) =>
      console.error("[resend] sendConfirmEmail failed:", err.message)
    );

    return res.json({ ok: true, message: "Verification email resent" });
  } catch (err) {
    console.error("resend error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ---------------- Email verification status ---------------- */
router.get("/email/status", authenticateToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: ["id", "emailVerified"] });
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({ ok: true, emailVerified: !!user.emailVerified });
  } catch (err) {
    console.error("status error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ------------------ Admin creates Vendor/Admin ------------------ */
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
      { name, email, password, role: normalizedRole, emailVerified: false },
      { transaction: t }
    );

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
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        emailVerified: !!newUser.emailVerified,
      },
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
        emailVerified: !!user.emailVerified,
      },
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
    if (password) user.password = password; // assumes model hook hashes on save

    await user.save();
    res.json({
      message: "Profile updated",
      user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: !!user.emailVerified },
    });
  } catch (err) {
    console.error("❌ Update failed:", err);
    res.status(500).json({ message: "Update failed", error: err.message });
  }
});

/* ----------------------- /auth/me -------------------------- */
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.id ?? req.user?.userId);
    if (!Number.isFinite(userId)) {
      return res.status(401).json({ message: "Unauthorized: no user id" });
    }

    const user = await User.findByPk(userId, {
      attributes: ["id", "name", "email", "role", "emailVerified"],
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const role = String(user.role || "").toLowerCase();
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
          cuisine: null,
          isOpen: true,
          isDeleted: false,
        });
      } else if (vendor.isDeleted) {
        vendor.isDeleted = false;
        await vendor.save();
      }
    } else {
      vendor = await Vendor.findOne({
        where: { UserId: user.id },
        attributes: ["id", "name", "location", "isOpen", "isDeleted"],
      });
    }

    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: !!user.emailVerified,
      vendorId: vendor ? vendor.id : null,
      vendor: vendor
        ? {
            id: vendor.id,
            name: vendor.name,
            location: vendor.location,
            isOpen: !!vendor.isOpen,
          }
        : null,
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