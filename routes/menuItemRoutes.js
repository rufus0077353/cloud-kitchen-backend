// routes/menuItemRoutes.js
const express = require("express");
const router = express.Router();
const { MenuItem } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

// GET all menu items for THIS vendor
router.get(
  "/mine",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const items = await MenuItem.findAll({
        where: { VendorId: req.vendor.id },
        order: [["createdAt", "DESC"]],
      });
      res.json(items);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch menu items", error: err.message });
    }
  }
);

// Public list (optionally by vendor)
router.get("/", async (req, res) => {
  try {
    const { vendorId } = req.query;
    if (!vendorId) return res.json([]); // avoid huge accidental dumps
    const idNum = Number(vendorId);
    if (!Number.isFinite(idNum)) return res.json([]);

    const items = await MenuItem.findAll({
      where: { VendorId: idNum, isAvailable: true },
      order: [["createdAt", "DESC"]],
    });
    res.json(items); // must be array
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch menu items", error: err.message });
  }
});

// CREATE a new menu item (derive VendorId from ensured profile)
router.post(
  "/",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const { name, price, description, isAvailable } = req.body || {};
      const priceNum = Number(price);
      if (!name || !Number.isFinite(priceNum)) {
        return res.status(400).json({ message: "Name and numeric price are required" });
      }

      const item = await MenuItem.create({
        name,
        price: priceNum,
        description,
        isAvailable: typeof isAvailable === "boolean" ? isAvailable : true,
        VendorId: req.vendor.id,
      });

      res.status(201).json({ message: "Menu item created", item });
    } catch (err) {
      res.status(500).json({ message: "Failed to create menu item", error: err.message });
    }
  }
);

// UPDATE a menu item (ownership check)
router.put(
  "/:id",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const item = await MenuItem.findByPk(req.params.id);
      if (!item) return res.status(404).json({ message: "Menu item not found" });
      if (item.VendorId !== req.vendor.id) return res.status(403).json({ message: "Not your menu item" });

      const { name, price, description, isAvailable } = req.body || {};
      const priceNum = price !== undefined ? Number(price) : undefined;

      await item.update({
        name: name ?? item.name,
        price: priceNum === undefined || Number.isNaN(priceNum) ? item.price : priceNum,
        description: description ?? item.description,
        isAvailable: typeof isAvailable === "boolean" ? isAvailable : item.isAvailable,
      });

      res.json({ message: "Menu item updated", item });
    } catch (err) {
      res.status(500).json({ message: "Failed to update menu item", error: err.message });
    }
  }
);

// DELETE a menu item (ownership check)
router.delete(
  "/:id",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const item = await MenuItem.findByPk(req.params.id);
      if (!item) return res.status(404).json({ message: "Menu item not found" });
      if (item.VendorId !== req.vendor.id) return res.status(403).json({ message: "Not your menu item" });

      await item.destroy();
      res.json({ message: "Menu item deleted" });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete menu item", error: err.message });
    }
  }
);

module.exports = router;