// middleware/ensureVendorProfile.js
const { Vendor } = require("../models");

// Only use columns that certainly exist in your DB.
// (Do NOT include logoUrl here to avoid the “column does not exist” error.)
const SAFE_VENDOR_ATTRS = [
  "id", "UserId", "isOpen", "name", "location", "cuisine", "phone", "isDeleted"
];

module.exports = async function ensureVendorProfile(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Always fetch by UserId with a safe attribute list.
    let vendor = await Vendor.findOne({
      where: { UserId: req.user.id },
      attributes: SAFE_VENDOR_ATTRS,
    });

    // If none, create a minimal vendor row (ONLY safe columns)
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
      // refetch with safe attributes
      vendor = await Vendor.findByPk(vendor.id, { attributes: SAFE_VENDOR_ATTRS });
    }

    if (!vendor || vendor.isDeleted) {
      return res.status(404).json({ message: "Vendor profile not found" });
    }

    // Attach for downstream handlers
    req.vendor = { id: Number(vendor.id), UserId: Number(vendor.UserId) };
    next();
  } catch (err) {
    // If the DB throws “column does not exist”, surface a gentle message.
    const msg = /does not exist|no such column|42703/i.test(err?.message || "")
      ? "Failed to ensure vendor profile: a column in Vendor table is missing. Remove unknown attributes (e.g. logoUrl) or add the column."
      : "Failed to ensure vendor profile";
    res.status(500).json({ message: msg, error: err.message });
  }
};