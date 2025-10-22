
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

    // unified ID reference (handles { userId } or { id })
    const userId = Number(decoded.userId ?? decoded.id);
    if (!Number.isFinite(userId)) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Attach normalized user object
    req.user = { id: user.id, role: user.role };

    // Attach vendorId if vendor user
    if (user.role === "vendor") {
      const vendor = await Vendor.findOne({
        where: { UserId: user.id },
        attributes: ["id"],
      });
      if (vendor) req.user.vendorId = vendor.id;
    }

    next();
  } catch (err) {
    console.error("❌ Token verification failed:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

exports.requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin")
    return res.status(403).json({ message: "Admins only" });
  next();
};

exports.requireVendor = (req, res, next) => {
  if (req.user?.role !== "vendor")
    return res.status(403).json({ message: "Vendors only" });
  next();
};