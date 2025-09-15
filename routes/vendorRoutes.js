
// routes/vendorRoutes.js
const express = require("express");
const router = express.Router();

const { Vendor, MenuItem, User } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");
const  vendorController = require("../controllers/vendorController");
// Who am I (vendor)
router.get(
  "/me",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      // include isOpen so the dashboard can reflect current state
      const v = await Vendor.findByPk(req.vendor.id, { attributes: ["id", "UserId", "isOpen"] });
      res.json({ vendorId: v.id, userId: req.user.id, isOpen: !!v.isOpen });
    } catch (e) {
      res.status(500).json({ message: "Failed to load vendor profile", error: e.message });
    }
  }
);

// 🔁 TOGGLE OPEN/CLOSED (current vendor)
router.patch(
  "/me/open",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const { isOpen } = req.body;
      if (typeof isOpen !== "boolean") {
        return res.status(400).json({ message: "isOpen must be boolean" });
      }

      const vendor = await Vendor.findByPk(req.vendor.id);
      if (!vendor) return res.status(404).json({ message: "Vendor not found" });

      vendor.isOpen = isOpen;
      await vendor.save();

      // Broadcast to all connected clients (users + vendors) so UIs refresh live
      const io = req.app.get("io");
      if (io) io.emit("vendor:status", { vendorId: vendor.id, isOpen: vendor.isOpen });

      return res.json({ message: "Vendor status updated", vendorId: vendor.id, isOpen: vendor.isOpen });
    } catch (err) {
      return res.status(500).json({ message: "Failed to update vendor status", error: err.message });
    }
  }
);

// All vendors (public) — include isOpen so users can see open/closed
router.get("/", async (_req, res) => {
  try {
    const vendors = await Vendor.findAll({
      attributes: ["id", "name", "location", "cuisine", "isOpen"],
      order: [["createdAt", "DESC"]],
    });
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
    const vendor = await Vendor.create({ name, location, cuisine, UserId, isOpen: true });
    res.status(201).json({ message: "Vendor created", vendor });
  } catch (err) {
    res.status(500).json({ message: "Error creating vendor", error: err.message });
  }
});

// Vendor menu (public) — only available items
router.get("/:id/menu", async (req, res) => {
  try {
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum)) {
      return res.status(400).json({ message: "Invalid vendor id" });
    }
    const vendor = await Vendor.findByPk(idNum, { attributes: ["id", "isOpen"] });
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }
    const items = await MenuItem.findAll({
      where: { VendorId: idNum, isAvailable: true },
      order: [["createdAt", "DESC"]],
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor menu", error: err.message });
  }
});

// Get vendor by ID (public)
router.get("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id, {
      attributes: ["id", "name", "location", "cuisine", "isOpen"],
    });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendor", error: err.message });
  }
});

// Update vendor
router.put("/:id", authenticateToken, async (req, res) => {
  const { name, cuisine, location, isOpen } = req.body;
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    vendor.name      = name ?? vendor.name;
    vendor.cuisine   = cuisine ?? vendor.cuisine;
    vendor.location  = location ?? vendor.location;
    if (typeof isOpen === "boolean") vendor.isOpen = isOpen;

    await vendor.save();

    // broadcast if open state actually changed via this endpoint
    if (typeof isOpen === "boolean") {
      const io = req.app.get("io");
      if (io) io.emit("vendor:status", { vendorId: vendor.id, isOpen: vendor.isOpen });
    }

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