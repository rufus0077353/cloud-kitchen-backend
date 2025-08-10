
// routes/vendorRoutes.js
const express = require("express");
const router = express.Router();

const { Vendor, MenuItem, User } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

/**
 * IMPORTANT: Order of routes matters.
 * Place static paths (like /me) BEFORE any param routes (/:id, /:id/menu)
 */

// 🔐 Who am I (as a vendor)? Returns { vendorId, userId }
router.get("/me",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  (req, res) => {
    res.json({ vendorId: req.vendor.id, userId: req.user.id });
  }
);

// 🔹 GET All Vendors (public)
router.get("/", async (req, res) => {
  try {
    const vendors = await Vendor.findAll();
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendors", error: err.message });
  }
});

// 🔹 CREATE Vendor (consider restricting to admins or vendor self)
router.post("/", authenticateToken, async (req, res) => {
  const { name, location, cuisine, UserId } = req.body;
  console.log("📥 Create Vendor Request:", req.body);

  if (!name || !location || !cuisine || !UserId) {
    return res.status(400).json({ message: "Name, location, cuisine, and UserId are required" });
  }

  try {
    // Optional: ensure UserId matches requester (if role-based control is needed)
    const vendor = await Vendor.create({ name, location, cuisine, UserId });
    res.status(201).json({ message: "Vendor created", vendor });
  } catch (err) {
    console.error("❌ Error creating vendor:", err);
    res.status(500).json({ message: "Error creating vendor", error: err.message });
  }
});

// 🔹 GET Menu Items by Vendor (public)
// Keep only ONE version to avoid duplicates. Using :id.
router.get("/:id/menu", async (req, res) => {
  try {
    const items = await MenuItem.findAll({ where: { VendorId: req.params.id } });
    res.json(items); // array
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor menu", error: err.message });
  }
});

// 🔹 GET Vendor by ID (public)
router.get("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendor", error: err.message });
  }
});

// 🔹 UPDATE Vendor (you may want to protect this)
router.put("/:id", authenticateToken, async (req, res) => {
  const { name, cuisine, location } = req.body;

  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    vendor.name = name ?? vendor.name;
    vendor.cuisine = cuisine ?? vendor.cuisine;
    vendor.location = location ?? vendor.location;

    await vendor.save();
    res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    res.status(500).json({ message: "Error updating vendor", error: err.message });
  }
});

// 🔹 DELETE Vendor (Hard Delete) (protect in real apps)
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    await vendor.destroy();
    res.json({ message: "Vendor deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting vendor", error: err.message });
  }
});

module.exports = router;