
// middleware/ensureVendorProfile.js
const { Vendor } = require("../models");

module.exports = async function ensureVendorProfile(req, res, next) {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Auth required" });

    let vendor = await Vendor.findOne({ where: { UserId: req.user.id } });

    if (!vendor) {
      const fallbackName =
        req.user.name || (req.user.email ? req.user.email.split("@")[0] : "My Kitchen");
      vendor = await Vendor.create({
        name: fallbackName,
        cuisine: "General",
        location: "N/A",
        isOpen: true,
        isDeleted: false,
        UserId: req.user.id,
      });
      console.log(`[ensureVendorProfile] created vendor ${vendor.id} for user ${req.user.id}`);
    } else if (vendor.isDeleted) {
      vendor.isDeleted = false;
      await vendor.save();
      console.log(`[ensureVendorProfile] revived vendor ${vendor.id} for user ${req.user.id}`);
    }

    req.vendor = vendor;
    next();
  } catch (err) {
    console.error("ensureVendorProfile error:", err?.message || err);
    res.status(500).json({ message: "Failed to ensure vendor profile", error: err.message });
  }
};