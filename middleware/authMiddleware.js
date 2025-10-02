// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const { User, Vendor } = require("../models");
const JWT_SECRET = process.env.JWT_SECRET || "nani@143";

exports.authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token missing" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Support either {userId} (current) or {id} (legacy)
    const uid = Number(decoded.userId ?? decoded.id);
    if (!Number.isFinite(uid)) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    const user = await User.findByPk(uid);
    if (!user) return res.status(404).json({ message: "User not found" });

    // attach minimal user info
    req.user = { id: user.id, role: user.role };

    // for vendor role, attach vendorId if it exists
    if (user.role === "vendor" && Vendor) {
      const v = await Vendor.findOne({ where: { UserId: user.id }, attributes: ["id"] });
      if (v) req.user.vendorId = v.id;
    }

    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

exports.requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admins only" });
  next();
};

exports.requireVendor = (req, res, next) => {
  if (req.user?.role !== "vendor") return res.status(403).json({ message: "Vendors only" });
  next();
};