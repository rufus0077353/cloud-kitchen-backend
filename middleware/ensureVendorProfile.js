
const { Vendor } = require("../models");

module.exports = async function ensureVendorProfile(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Auth required" });
    }

    let vendor = await Vendor.findOne({ where: { UserId: req.user.id } });

    if (!vendor) {
      const fallbackName = req.user.name || req.user.email?.split("@")[0] || "My Kitchen";
      vendor = await Vendor.create({
        name: fallbackName,
        cuisine: "General",
        location: "N/A",
        isOpen: true,
        UserId: req.user.id,
      });
      console.log(`[ensureVendorProfile] created vendor ${vendor.id} for user ${req.user.id}`);
    }

    req.vendor = { id: vendor.id, userId: vendor.UserId };
    next();
  } catch (err) {
    console.error("ensureVendorProfile error:", err.message || err);
    res.status(500).json({ message: "Failed to ensure vendor profile", error: err.message });
  }
};
