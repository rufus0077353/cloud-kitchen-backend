const { Vendor } = require("../models");

// Only safe, sure-to-exist attrs
const SAFE_VENDOR_ATTRS = [
  "id", "UserId", "isOpen", "name", "location", "cuisine", "phone", "isDeleted"
];

module.exports = async function ensureVendorProfile(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    let vendor = await Vendor.findOne({
      where: { UserId: req.user.id },
      attributes: SAFE_VENDOR_ATTRS,
    });

    if (!vendor) {
      vendor = await Vendor.create({
        UserId: req.user.id,
        name: req.user.name ? `${req.user.name}'s Kitchen` : "My Restaurant",
        cuisine: "Indian",
        location: "Unknown",
        phone: null,
        isOpen: true,
        isDeleted: false,
      });
    }

    if (!vendor || vendor.isDeleted) {
      return res.status(404).json({ message: "Vendor profile not found" });
    }

    req.vendor = { id: Number(vendor.id), UserId: Number(vendor.UserId) };
    next();
  } catch (err) {
    res.status(500).json({
      message: "Failed to ensure vendor profile",
      error: err.message,
    });
  }
};