
const express = require("express");
const router = express.Router();
const { MenuItem, Vendor } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

/**
 * Helper to resolve current vendorId safely.
 * - Prefer req.vendor.id (set by ensureVendorProfile)
 * - Fallback: look up Vendor by the authenticated user
 */
async function resolveVendorId(req) {
  if (req.vendor?.id) return req.vendor.id;

  // Fallback: try to find vendor profile by current user
  try {
    if (req.user?.id) {
      const v = await Vendor.findOne({ where: { UserId: req.user.id }, attributes: ["id"] });
      if (v) return v.id;
    }
  } catch (_) {}
  return null;
}

/* ===================== VENDOR-SCOPED ===================== */

/**
 * GET /api/menu-items/mine
 * Return menu items for the current vendor.
 * Previously 500ed when req.vendor was missing — now defensive with clear messages.
 */
router.get(
  "/mine",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = await resolveVendorId(req);

      if (!vendorId) {
        return res
          .status(400)
          .json({ message: "Vendor profile not found for this account." });
      }

      const items = await MenuItem.findAll({
        where: { VendorId: vendorId },
        order: [["createdAt", "DESC"]],
      });
      return res.json(items);
    } catch (err) {
      console.error("GET /menu-items/mine error:", err?.message || err);
      return res
        .status(500)
        .json({ message: "Failed to fetch menu items", error: err.message });
    }
  }
);

/**
 * POST /api/menu-items
 * Create a new menu item for the current vendor.
 * Now accepts optional imageUrl.
 */
router.post(
  "/",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = await resolveVendorId(req);
      if (!vendorId) {
        return res
          .status(400)
          .json({ message: "Vendor profile not found for this account." });
      }

      const { name, price, description, isAvailable, imageUrl } = req.body || {};
      const priceNum = Number(price);
      if (!name || !Number.isFinite(priceNum)) {
        return res
          .status(400)
          .json({ message: "Name and numeric price are required" });
      }

      const item = await MenuItem.create({
        name,
        price: priceNum,
        description: description ?? null,
        isAvailable: typeof isAvailable === "boolean" ? isAvailable : true,
        imageUrl: imageUrl ?? null,
        VendorId: vendorId,
      });

      return res.status(201).json({ message: "Menu item created", item });
    } catch (err) {
      console.error("POST /menu-items error:", err?.message || err);
      return res
        .status(500)
        .json({ message: "Failed to create menu item", error: err.message });
    }
  }
);

/**
 * PUT /api/menu-items/:id
 * Update an item (ownership enforced). Supports imageUrl.
 */
router.put(
  "/:id",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = await resolveVendorId(req);
      if (!vendorId) {
        return res
          .status(400)
          .json({ message: "Vendor profile not found for this account." });
      }

      const item = await MenuItem.findByPk(req.params.id);
      if (!item) return res.status(404).json({ message: "Menu item not found" });
      if (Number(item.VendorId) !== Number(vendorId)) {
        return res.status(403).json({ message: "Not your menu item" });
      }

      const {
        name,
        price,
        description,
        isAvailable,
        imageUrl, // NEW
      } = req.body || {};
      const priceNum = price !== undefined ? Number(price) : undefined;

      await item.update({
        name: name ?? item.name,
        price:
          priceNum === undefined || Number.isNaN(priceNum) ? item.price : priceNum,
        description: description ?? item.description,
        isAvailable:
          typeof isAvailable === "boolean" ? isAvailable : item.isAvailable,
        imageUrl: imageUrl === undefined ? item.imageUrl : imageUrl, // NEW
      });

      return res.json({ message: "Menu item updated", item });
    } catch (err) {
      console.error("PUT /menu-items/:id error:", err?.message || err);
      return res
        .status(500)
        .json({ message: "Failed to update menu item", error: err.message });
    }
  }
);

/**
 * DELETE /api/menu-items/:id
 */
router.delete(
  "/:id",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = await resolveVendorId(req);
      if (!vendorId) {
        return res
          .status(400)
          .json({ message: "Vendor profile not found for this account." });
      }

      const item = await MenuItem.findByPk(req.params.id);
      if (!item) return res.status(404).json({ message: "Menu item not found" });
      if (Number(item.VendorId) !== Number(vendorId)) {
        return res.status(403).json({ message: "Not your menu item" });
      }

      await item.destroy();
      return res.json({ message: "Menu item deleted" });
    } catch (err) {
      console.error("DELETE /menu-items/:id error:", err?.message || err);
      return res
        .status(500)
        .json({ message: "Failed to delete menu item", error: err.message });
    }
  }
);

/* ===================== PUBLIC ===================== */

/**
 * GET /api/menu-items?vendorId=123
 * Public list by vendor (isAvailable only). Includes imageUrl if present.
 */
router.get("/", async (req, res) => {
  try {
    const { vendorId } = req.query;
    if (!vendorId) return res.json([]);
    const idNum = Number(vendorId);
    if (!Number.isFinite(idNum)) return res.json([]);

    const items = await MenuItem.findAll({
      where: { VendorId: idNum, isAvailable: true },
      order: [["createdAt", "DESC"]],
    });
    return res.json(items);
  } catch (err) {
    console.error("GET /menu-items error:", err?.message || err);
    return res
      .status(500)
      .json({ message: "Failed to fetch menu items", error: err.message });
  }
});

module.exports = router;