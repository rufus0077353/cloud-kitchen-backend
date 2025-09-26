// middleware/ensureVendorProfile.js
const { Vendor } = require("../models");

// Only use columns that certainly exist in DB.
const SAFE_VENDOR_ATTRS = [
  "id", "UserId", "isOpen", "name", "location", "cuisine", "phone", "logoUrl", "isDeleted"
];

module.exports = async function ensureVendorProfile(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Fetch by user
    let vendor = await Vendor.findOne({
      where: { UserId: req.user.id },
      attributes: SAFE_VENDOR_ATTRS,
    });

    // Create a minimal profile if missing
    if (!vendor) {
      vendor = await Vendor.create({
        UserId: req.user.id,
        name: req.user.name ? `${req.user.name}'s Kitchen` : "My Restaurant",
        cuisine: "Indian",
        location: "Unknown",
        phone: null,
        logoUrl: null,
        isOpen: true,
        isDeleted: false,
      });
      vendor = await Vendor.findByPk(vendor.id, { attributes: SAFE_VENDOR_ATTRS });
    }

    if (!vendor || vendor.isDeleted) {
      return res.status(404).json({ message: "Vendor profile not found" });
    }

    req.vendor = { id: Number(vendor.id), UserId: Number(vendor.UserId) };
    next();
  } catch (err) {
    const msg = /does not exist|no such column|42703/i.test(err?.message || "")
      ? "Failed to ensure vendor profile: a column in Vendor table is missing. Ensure 'logoUrl', 'phone', 'cuisine', 'location', 'isOpen' exist (or remove them from the code)."
      : "Failed to ensure vendor profile";
    res.status(500).json({ message: msg, error: err.message });
  }
};