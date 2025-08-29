
// routes/vendorRoutes.js
const express = require("express");
const router = express.Router();

const { Vendor, MenuItem } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

// Who am I (vendor)
router.get("/me",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  (req, res) => {
    res.json({ vendorId: req.vendor.id, userId: req.user.id });
  }
);

// All vendors
router.get("/", async (_req, res) => {
  try {
    const vendors = await Vendor.findAll();
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendors", error: err.message });
  }
});

// Create vendor (simple)
router.post("/", authenticateToken, async (req, res) => {
  const { name, location, cuisine, UserId } = req.body;
  if (!name || !location || !cuisine || !UserId) {
    return res.status(400).json({ message: "Name, location, cuisine, and UserId are required" });
  }
  try {
    const vendor = await Vendor.create({ name, location, cuisine, UserId });
    res.status(201).json({ message: "Vendor created", vendor });
  } catch (err) {
    res.status(500).json({ message: "Error creating vendor", error: err.message });
  }
});

// Vendor menu (public) — only available items
router.get("/:id/menu", async (req, res) => {
  try {
    const items = await MenuItem.findAll({
      where: { VendorId: req.params.id, isAvailable: true }
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor menu", error: err.message });
  }
});

// Get vendor by ID (public)
router.get("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendor", error: err.message });
  }
});

// Update vendor
router.put("/:id", authenticateToken, async (req, res) => {
  const { name, cuisine, location } = req.body;
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    vendor.name     = name ?? vendor.name;
    vendor.cuisine  = cuisine ?? vendor.cuisine;
    vendor.location = location ?? vendor.location;

    await vendor.save();
    res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    res.status(500).json({ message: "Error updating vendor", error: err.message });
  }
});

// Delete vendor (hard)
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