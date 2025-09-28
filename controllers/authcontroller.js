
const { User, Vendor } = require("../models");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const JWT_SECRET = process.env.JWT_SECRET || "nani@143";

function publicUser(u) {
  if (!u) return null;
  const { id, name, email, role, createdAt, updatedAt } = u.get ? u.get() : u;
  return { id, name, email, role, createdAt, updatedAt };
}

exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(409).json({ message: "Email already registered" });

    const user = await User.create({
      name,
      email,
      password, // hashed in model hook
      role: (role || "user").toLowerCase(),
    });

    if (user.role === "vendor" && Vendor) {
      await Vendor.create({
        UserId: user.id,
        name: `${user.name}'s Kitchen`,
        cuisine: "General",
        location: "Unknown",
        isOpen: true,
        isDeleted: false,
      }).catch(() => {});
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    return res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ message: "Registration failed", error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

    const user = await User.findOne({ where: { email } });
    if (!user || !(await user.validPassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "Login failed", error: err.message });
  }
};

exports.me = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json(publicUser(user));
  } catch (err) {
    return res.status(500).json({ message: "Failed to load profile", error: err.message });
  }
};

exports.adminCreateUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields required" });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(409).json({ message: "Email already registered" });

    const user = await User.create({
      name,
      email,
      password,
      role: role.toLowerCase(),
    });

    return res.status(201).json({ message: "User created", user: publicUser(user) });
  } catch (err) {
    return res.status(500).json({ message: "Admin create failed", error: err.message });
  }
};