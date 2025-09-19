const jwt = require("jsonwebtoken");
const { User, Vendor } = require("../models");

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

const authenticateToken = async (req, res, next) => {
 const authHeader = req.headers.authorization;
 const token = authHeader && authHeader.split(" ")[1];
 if (!token) return res.status(401).json({ message: "Token missing" });

 try {
   const decoded = jwt.verify(token, JWT_SECRET);
   const user = await User.findByPk(decoded.userId);
   if (!user) return res.status(404).json({ message: "User not found" });

   // base shape
   req.user = { id: user.id, role: user.role };

   // hydrate vendor info for convenience (many routes expect this)
   try {
     const v = await Vendor.findOne({ where: { UserId: user.id }, attributes: ["id"] });
     if (v?.id) {
       req.user.vendorId = Number(v.id);
       // some middlewares (ensureVendorProfile / requireVendor flows) expect req.vendor
       req.vendor = { id: Number(v.id) };
     }
   } catch (_) {
     // if Vendor table missing or not linked, just continue
   }

   next();
 } catch (err) {
   return res.status(401).json({ message: "Invalid or expired token" });
 }
};

const requireAdmin = (req, res, next) => {
 if (req.user?.role !== "admin") {
   return res.status(403).json({ message: "Forbidden: Admins only" });
 }
 next();
};

const requireVendor = (req, res, next) => {
 if (req.user?.role !== "vendor") {
   return res.status(403).json({ message: "Forbidden: Vendors only" });
 }
 next();
};

module.exports = { authenticateToken, requireAdmin, requireVendor };