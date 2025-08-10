// middleware/ensureVendorProfile.js
const { Vendor, User } = require("../models");

module.exports = async function ensureVendorProfile(req, res, next) {
  try {
    // must already be authenticated & role=vendor
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    let vendor = await Vendor.findOne({ where: { UserId: userId } });

    if (!vendor) {
      // best-effort defaults (can be overridden later via vendor settings)
      const user = await User.findByPk(userId);
      vendor = await Vendor.create({
        UserId: userId,
        name: user?.name || `Vendor ${userId}`,
        cuisine: req.body?.cuisine || null,
        location: req.body?.location || "unspecified",
      });
      // optional: log creation
      console.log(`✅ Auto-created vendor profile for user ${userId} (VendorId=${vendor.id})`);
    }

    req.vendor = vendor; // attach for downstream handlers
    return next();
  } catch (err) {
    console.error("ensureVendorProfile error:", err);
    return res.status(500).json({ message: "Failed to ensure vendor profile", error: err.message });
  }
};