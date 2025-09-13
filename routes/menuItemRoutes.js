// backend/routes/menuItemRoutes.js  (READY-PASTE)
const express = require("express");
const router = express.Router();
const { MenuItem } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

/* ---------- helpers ---------- */
const isHttpUrl = (v) => {
  if (!v) return true; // optional
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const publicAttrs = ["id", "name", "price", "description", "isAvailable", "imageUrl", "VendorId", "createdAt", "updatedAt"];

/* ---------- GET all menu items for THIS vendor ---------- */
router.get(
  "/mine",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const items = await MenuItem.findAll({
        where: { VendorId: req.vendor.id },
        attributes: publicAttrs,
        order: [["createdAt", "DESC"]],
      });
      res.json(items);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch menu items", error: err.message });
    }
  }
);

/* ---------- Public list (optionally by vendor) ---------- */
router.get("/", async (req, res) => {
  try {
    const { vendorId } = req.query;
    if (!vendorId) return res.json([]);
    const idNum = Number(vendorId);
    if (!Number.isFinite(idNum)) return res.json([]);

    const items = await MenuItem.findAll({
      where: { VendorId: idNum, isAvailable: true },
      attributes: publicAttrs,
      order: [["createdAt", "DESC"]],
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch menu items", error: err.message });
  }
});

/* ---------- CREATE (derive VendorId from ensured profile) ---------- */
router.post(
  "/",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const { name, price, description, isAvailable, imageUrl } = req.body || {};
      const priceNum = Number(price);

      if (!name || !Number.isFinite(priceNum)) {
        return res.status(400).json({ message: "Name and numeric price are required" });
      }
      if (!isHttpUrl(imageUrl)) {
        return res.status(400).json({ message: "imageUrl must be an http(s) URL if provided" });
      }

      const item = await MenuItem.create({
        name,
        price: priceNum,
        description: description ?? null,
        isAvailable: typeof isAvailable === "boolean" ? isAvailable : true,
        imageUrl: imageUrl || null,
        VendorId: req.vendor.id,
      });

      res.status(201).json({ message: "Menu item created", item });
    } catch (err) {
      res.status(500).json({ message: "Failed to create menu item", error: err.message });
    }
  }
);

/* ---------- UPDATE (ownership check) ---------- */
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

      const { name, price, description, isAvailable, imageUrl } = req.body || {};
      const priceNum = price !== undefined ? Number(price) : undefined;

      if (imageUrl !== undefined && !isHttpUrl(imageUrl)) {
        return res.status(400).json({ message: "imageUrl must be an http(s) URL if provided" });
      }

      await item.update({
        name: name ?? item.name,
        price: priceNum === undefined || Number.isNaN(priceNum) ? item.price : priceNum,
        description: description ?? item.description,
        isAvailable: typeof isAvailable === "boolean" ? isAvailable : item.isAvailable,
        imageUrl: imageUrl === undefined ? item.imageUrl : (imageUrl || null), // allow clearing to null
      });

      res.json({ message: "Menu item updated", item });
    } catch (err) {
      res.status(500).json({ message: "Failed to update menu item", error: err.message });
    }
  }
);

/* ---------- DELETE (ownership check) ---------- */
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