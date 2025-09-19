// routes/adminCleanupRoutes.js
const express = require("express");
const router = express.Router();

const { Vendor, MenuItem, Order, User } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");

/**
 * NOTE: All endpoints here are admin-only.
 * Goal: find duplicate / orphan vendors and (safely) delete ones with no data attached.
 */

// Small helper to get counts for one vendor
async function getVendorCounts(id) {
  const [menuItems, orders] = await Promise.all([
    MenuItem.count({ where: { VendorId: id } }),
    Order.count({ where: { VendorId: id } }),
  ]);
  return { menuItems, orders };
}

/**
 * GET /api/admin-cleanup/vendors
 * List all vendors with counts so you can see which ones are safe to remove.
 */
router.get("/vendors", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const rows = await Vendor.findAll({
      attributes: ["id", "name", "UserId", "createdAt", "updatedAt", "isOpen"],
      include: [{ model: User, attributes: ["id", "name", "email"] }],
      order: [["createdAt", "ASC"]],
    });

    const out = [];
    for (const v of rows) {
      const c = await getVendorCounts(v.id);
      out.push({
        id: v.id,
        name: v.name,
        userId: v.UserId,
        userName: v.User?.name || null,
        userEmail: v.User?.email || null,
        isOpen: v.isOpen,
        menuItems: c.menuItems,
        orders: c.orders,
        createdAt: v.createdAt,
      });
    }

    res.json(out);
  } catch (e) {
    res.status(500).json({ message: "Failed to list vendors", error: e.message });
  }
});

/**
 * GET /api/admin-cleanup/suspects
 * Only vendors with ZERO menu items AND ZERO orders (safest to delete).
 */
router.get("/suspects", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const vendors = await Vendor.findAll({ attributes: ["id", "name", "UserId"] });
    const suspects = [];
    for (const v of vendors) {
      const { menuItems, orders } = await getVendorCounts(v.id);
      if (menuItems === 0 && orders === 0) {
        suspects.push({ id: v.id, name: v.name, userId: v.UserId, menuItems, orders });
      }
    }
    res.json(suspects);
  } catch (e) {
    res.status(500).json({ message: "Failed to scan suspects", error: e.message });
  }
});

/**
 * DELETE /api/admin-cleanup/vendors/:id
 * Deletes a vendor only if it has ZERO menu items AND ZERO orders.
 * (Use ?force=true to override, but avoid unless you really mean it.)
 */
router.delete("/vendors/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Bad vendor id" });

    const force = String(req.query.force || "").toLowerCase() === "true";
    const vendor = await Vendor.findByPk(id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const { menuItems, orders } = await getVendorCounts(id);

    if (!force && (menuItems > 0 || orders > 0)) {
      return res.status(409).json({
        message: "Cannot delete: vendor has data attached",
        menuItems,
        orders,
        hint: "Call with ?force=true ONLY if you know what you are doing.",
      });
    }

    // If you want to also remove menu items when forcing, uncomment:
    // await MenuItem.destroy({ where: { VendorId: id } });
    // await Order.destroy({ where: { VendorId: id } }); // be careful!

    await vendor.destroy();
    res.json({ message: "Vendor deleted", id, menuItems, orders, forced: force });
  } catch (e) {
    res.status(500).json({ message: "Delete failed", error: e.message });
  }
});

module.exports = router;