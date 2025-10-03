const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const { Vendor, MenuItem, Order, OrderItem, Payout } = require("../models");
const { authenticateToken, requireVendor, requireAdmin } = require("../middleware/authMiddleware");

// Only request columns we know exist in the database
const SAFE_VENDOR_ATTRS = [
  "id", "UserId", "isOpen", "name", "location", "cuisine", "phone", "isDeleted", "createdAt", "updatedAt"
];

/** Find vendor for a user; create a minimal one if missing. */
async function getOrCreateVendorForUser(userId) {
  if (!userId) return null;
  let v = await Vendor.findOne({ where: { UserId: userId } });
  if (!v) {
    v = await Vendor.create({
      UserId: userId,
      name: `Vendor ${userId}`,
      location: "TBD",
      cuisine: null,
      phone: null,
      isOpen: true,
      isDeleted: false,
    });
  }
  return v;
}

async function allVendorIdsForUser(userId) {
  const rows = await Vendor.findAll({ where: { UserId: userId }, attributes: ["id"] });
  return rows.map(r => Number(r.id)).filter(Number.isFinite);
}

/* ============== WHO AM I (self-healing) ============== */
router.get("/me", authenticateToken, requireVendor, async (req, res) => {
  try {
    const v = await getOrCreateVendorForUser(req.user.id);
    if (!v) return res.status(404).json({ message: "Vendor profile not found" });

    // respond directly with what we already have (no second query)
    const safe = {
      id: v.id,
      UserId: v.UserId,
      isOpen: v.isOpen,
      name: v.name || "",
      location: v.location || "",
      cuisine: v.cuisine || "",
      phone: v.phone || null,
      isDeleted: Boolean(v.isDeleted),
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
    res.json({ vendorId: v.id, userId: req.user.id, ...safe });
  } catch (e) {
    res.status(500).json({ message: "Failed to load vendor profile", error: e.message });
  }
});

/* ============== TOGGLE OPEN/CLOSED ============== */
router.patch(
  "/me/open",
  authenticateToken,
  requireVendor,
  async (req, res) => {
    try {
      const { isOpen } = req.body;
      if (typeof isOpen !== "boolean") {
        return res.status(400).json({ message: "isOpen must be boolean" });
      }
      const v = await getOrCreateVendorForUser(req.user.id);
      if (!v || v.isDeleted) return res.status(404).json({ message: "Vendor not found" });
      v.isOpen = isOpen;
      await v.save();

      const io = req.app.get("io");
      if (io) io.emit("vendor:status", { vendorId: v.id, isOpen: v.isOpen });
      res.json({ message: "Vendor status updated", vendor: v });
    } catch (err) {
      res.status(500).json({ message: "Failed to update vendor status", error: err.message });
    }
  }
);

/* ============== PUBLIC: LIST ALL ============== */
router.get("/", async (_req, res) => {
  try {
    const vendors = await Vendor.findAll({
      where: { isDeleted: { [Op.not]: true } },
      attributes: SAFE_VENDOR_ATTRS.filter(k => k !== "UserId" && k !== "isDeleted"),
      order: [["createdAt", "DESC"]],
    });
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendors", error: err.message });
  }
});

/* ============== CREATE / REUSE (IDEMPOTENT) ============== */
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name, location, cuisine, UserId, phone } = req.body;
    if (!name || !location || !cuisine) {
      return res.status(400).json({ message: "Name, location, and cuisine are required" });
    }
    const userId = UserId || req.user.id;

    let vendor = await Vendor.findOne({ where: { UserId: userId }, attributes: SAFE_VENDOR_ATTRS });

    if (!vendor) {
      vendor = await Vendor.create({
        UserId: userId,
        name, location, cuisine,
        isOpen: true,
        phone: phone || null,
        isDeleted: false,
      });
      return res.status(201).json({ message: "Vendor created", vendor, created: true });
    }

    if (vendor.isDeleted) vendor.isDeleted = false;
    vendor.name = name ?? vendor.name;
    vendor.location = location ?? vendor.location;
    vendor.cuisine = cuisine ?? vendor.cuisine;
    vendor.phone = phone ?? vendor.phone;
    await vendor.save();

    res.status(200).json({ message: "Vendor reused", vendor, created: false });
  } catch (err) {
    res.status(500).json({ message: "Error creating/reusing vendor", error: err.message });
  }
});

/* ============== PUBLIC: MENU BY VENDOR ============== */
router.get("/:id/menu", async (req, res) => {
  try {
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum)) return res.status(400).json({ message: "Invalid vendor id" });

    const vendor = await Vendor.findByPk(idNum, { attributes: ["id", "isOpen", "isDeleted"] });
    if (!vendor || vendor.isDeleted) return res.status(404).json({ message: "Vendor not found" });

    const items = await MenuItem.findAll({
      where: { VendorId: idNum, isAvailable: true },
      order: [["createdAt", "DESC"]],
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor menu", error: err.message });
  }
});

/* ============== PUBLIC: GET VENDOR BY ID ============== */
router.get("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findOne({
      where: { id: req.params.id, isDeleted: { [Op.not]: true } },
      attributes: SAFE_VENDOR_ATTRS.filter(k => k !== "UserId" && k !== "isDeleted"),
    });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendor", error: err.message });
  }
});

/* ============== UPDATE VENDOR ============== */
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { name, cuisine, location, isOpen, phone } = req.body;
    const vendor = await Vendor.findByPk(req.params.id, { attributes: SAFE_VENDOR_ATTRS });
    if (!vendor || vendor.isDeleted) return res.status(404).json({ message: "Vendor not found" });

    vendor.name = name ?? vendor.name;
    vendor.cuisine = cuisine ?? vendor.cuisine;
    vendor.location = location ?? vendor.location;
    vendor.phone = phone ?? vendor.phone;
    if (typeof isOpen === "boolean") vendor.isOpen = isOpen;

    await vendor.save();

    if (typeof isOpen === "boolean") {
      const io = req.app.get("io");
      if (io) io.emit("vendor:status", { vendorId: vendor.id, isOpen: vendor.isOpen });
    }

    res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    res.status(500).json({ message: "Error updating vendor", error: err.message });
  }
});

/* ============== SOFT DELETE (ADMIN) ============== */
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum)) return res.status(400).json({ message: "Invalid id" });

    const vendor = await Vendor.findByPk(idNum);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    vendor.isDeleted = true;
    await vendor.save();

    res.json({ message: "Vendor soft-deleted", vendorId: idNum });
  } catch (e) {
    res.status(500).json({ message: "Soft delete failed", error: e.message });
  }
});

/* ============== HARD DELETE + CASCADE (ADMIN) ============== */
router.delete("/:id/force", authenticateToken, requireAdmin, async (req, res) => {
  const t = await Vendor.sequelize.transaction();
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { await t.rollback(); return res.status(400).json({ message: "Invalid id" }); }

    const v = await Vendor.findByPk(id, { transaction: t });
    if (!v) { await t.rollback(); return res.status(404).json({ message: "Vendor not found" }); }

    const orders = await Order.findAll({ where: { VendorId: id }, attributes: ["id"], transaction: t });
    const orderIds = orders.map(o => o.id);

    let deletedOrderItems = 0;
    if (orderIds.length) {
      deletedOrderItems = await OrderItem.destroy({ where: { OrderId: { [Op.in]: orderIds } }, transaction: t });
    }

    const deletedOrders = await Order.destroy({ where: { VendorId: id }, transaction: t });

    let deletedPayouts = 0;
    if (Payout && typeof Payout.destroy === "function") {
      deletedPayouts = await Payout.destroy({ where: { VendorId: id }, transaction: t });
    }

    const deletedMenuItems = await MenuItem.destroy({ where: { VendorId: id }, transaction: t });

    await Vendor.destroy({ where: { id }, transaction: t });

    await t.commit();
    res.json({ message: "Vendor and related data deleted", counts: { orders: deletedOrders, orderItems: deletedOrderItems, menuItems: deletedMenuItems, payouts: deletedPayouts } });
  } catch (e) {
    try { await t.rollback(); } catch {}
    res.status(500).json({ message: "Force delete failed", error: e.message });
  }
});

/* ============== LEGACY PAYOUTS (for dashboard) ============== */
router.get(
  "/:id/payouts",
  authenticateToken,
  requireVendor,
  async (req, res) => {
    try {
      const idNum = Number(req.params.id);
      const myIds = await allVendorIdsForUser(req.user.id);
      if (!myIds.includes(idNum)) return res.status(403).json({ message: "Not your vendor" });

      const where = {
        VendorId: idNum,
        status: { [Op.notIn]: ["rejected", "canceled"] },
        paymentStatus: "paid",
      };
      const grossPaid = (await Order.sum("totalAmount", { where })) || 0;
      const paidOrders = await Order.count({ where });
      const commission = +(grossPaid * Number(process.env.COMMISSION_PCT || 0.15)).toFixed(2);
      const netOwed = +(grossPaid - commission).toFixed(2);
      res.json({ vendorId: idNum, paidOrders, grossPaid: +grossPaid.toFixed(2), commission, netOwed });
    } catch (e) {
      res.status(500).json({ message: "Failed to build payouts", error: e.message });
    }
  }
);

module.exports = router;