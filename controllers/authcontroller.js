
// controllers/authController.js
const { User } = require("../models");
const jwt = require("jsonwebtoken");

function mustGetJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Log loudly on the server so it's obvious in Render logs.
    console.error("❌ JWT_SECRET is not set. Configure it in your environment variables.");
    // Throw a controlled error so we respond 500 with a clear message.
    const e = new Error("Server misconfiguration: JWT secret missing");
    e.statusCode = 500;
    throw e;
  }
  return secret;
}

function publicUser(u) {
  if (!u) return null;
  const { id, name, email, role, isDeleted, createdAt, updatedAt } = u.get ? u.get() : u;
  return { id, name, email, role, isDeleted, createdAt, updatedAt };
}

exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const user = await User.create({
      name,
      email,
      password, // hashed by model hook
      role: role || "user",
    });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      mustGetJwtSecret(),
      { expiresIn: "7d" }
    );

    return res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("register error:", err);
    const code = err.statusCode || 500;
    return res.status(code).json({ message: "Registration failed", error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isValid = await user.validPassword(password);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      mustGetJwtSecret(),
      { expiresIn: "7d" }
    );

    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("login error:", err);
    const code = err.statusCode || 500;
    return res.status(code).json({ message: "Login failed", error: err.message });
  }
};

exports.me = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "name", "email", "role", "isDeleted", "createdAt", "updatedAt"],
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json(publicUser(user));
  } catch (err) {
    console.error("me error:", err);
    return res.status(500).json({ message: "Failed to load profile", error: err.message });
  }
};