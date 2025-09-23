
// middleware/ensureVendorProfile.js
const { Vendor } = require("../models");

/**
 * Ensures that a logged-in vendor user has a vendor profile.
 * - Never references optional columns like `logoUrl` or `phone`
 *   (so it won't crash if those columns are missing in the DB).
 * - Creates a minimal vendor row if none exists.
 * - Attaches the vendor record to req.vendor
 */
module.exports = async function ensureVendorProfile(req, res, next) {
  try {
    // only run for vendor role; admins/customers skip quietly
    if (!req.user || req.user.role !== "vendor") {
      return next();
    }

    // try to find existing vendor for this user
    let vendor = await Vendor.findOne({ where: { UserId: req.user.id } });

    // if not found, create a minimal record (no phone/logoUrl here)
    if (!vendor) {
      const fallbackName = req.user.name || "My Kitchen";
      const fallbackLoc  = "Unknown";
      const fallbackCui  = "General";

      vendor = await Vendor.create({
        UserId: req.user.id,
        name: fallbackName,
        location: fallbackLoc,
        cuisine: fallbackCui,
        isOpen: true,
      });
    }

    // attach to request for downstream routes
    req.vendor = vendor;
    next();
  } catch (err) {
    console.error("ensureVendorProfile error:", err.message || err);
    return res.status(500).json({
      message: "Failed to ensure vendor profile",
      error: err.message,
    });
  }
};
