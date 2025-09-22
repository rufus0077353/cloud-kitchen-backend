
// middleware/ensureVendorProfile.js
const { Vendor } = require("../models");

/**
 * Guarantee req.vendor is present for a logged-in user.
 * - If a vendor exists but is soft-deleted, revive it.
 * - If no vendor exists, create a minimal one.
 */
module.exports = async function ensureVendorProfile(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Auth required" });
    }

    // find vendor for this user (include soft-deleted if your model uses paranoid)
    let vendor = await Vendor.findOne({ where: { UserId: req.user.id } });

    if (!vendor) {
      // create a minimal vendor
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
      console.log(`[ensureVendorProfile] Created vendor ${vendor.id} for user ${req.user.id}`);
    } else if (vendor.isDeleted) {
      // revive the soft-deleted vendor
      vendor.isDeleted = false;
      await vendor.save();
      console.log(`[ensureVendorProfile] Revived vendor ${vendor.id} for user ${req.user.id}`);
    }

    req.vendor = vendor;
    next();
  } catch (err) {
    console.error("ensureVendorProfile error:", err?.message || err);
    res.status(500).json({ message: "Failed to ensure vendor profile", error: err.message });
  }
};