
// routes/menuItemRoutes.js
const express = require("express");
const router = express.Router();
const { MenuItem } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");
const { or } = require("sequelize");

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
        order: [["createdAt", "DESC"]]
      });
      res.json(items);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch menu items", error: err.message });
    }
  }
);

router.get("/", async (req, res) => {
  try {
    const { vendorId } = req.query;
    if (!vendorId) {
      // optional: return all or []
      return res.json([]); // safest to avoid huge payloads/accidents
    }
    const items = await MenuItem.findAll({ where: { VendorId: vendorId } });
    res.json(items); // must be an array
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
      if (!name || Number.isNaN(priceNum)) {
        return res.status(400).json({ message: "Name and price are required" });
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
      if (item.VendorId !== req.vendor.id)
        return res.status(403).json({ message: "Not your menu item" });

      const { name, price, description, isAvailable } = req.body || {};
      const proceNum = price !== undefined ? Number(price) : undefined;

      await item.update({
        name: name ?? item.name,
        price: proceNum === undefined || Number.isNaN(proceNum) ? item.price : proceNum,
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
      if (item.VendorId !== req.vendor.id)
        return res.status(403).json({ message: "Not your menu item" });

      await item.destroy();
      res.json({ message: "Menu item deleted" });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete menu item", error: err.message });
    }
  }
);

module.exports = router;