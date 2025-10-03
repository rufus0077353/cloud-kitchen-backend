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

/* ============== PAYOUTS (SUMMARY FOR DASHBOARD) ============== */
// Returns: { vendorId, paidOrders, grossPaid, commission, netOwed }
router.get("/:id/payouts", authenticateToken, requireVendor, async (req, res) => {
  const t = await Vendor.sequelize.transaction();
  try {
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum)) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid vendor id" });
    }

    // ensure this vendor belongs to the authed user
    const myIds = (
      await Vendor.findAll({ where: { UserId: req.user.id }, attributes: ["id"], transaction: t })
    ).map(v => v.id);
    if (!myIds.includes(idNum)) {
      await t.rollback();
      return res.status(403).json({ message: "Not your vendor" });
    }

    // ---- Try the most robust way: compute from OrderItems × MenuItem.price
    // accepted statuses that we count as "paid/complete"
    const DONE_STATUSES = ["delivered", "completed", "paid"]; // tweak if your app differs

    // fetch orders for this vendor that are complete-ish
    const orders = await Order.findAll({
      where: {
        VendorId: idNum,
        // if your Order model doesn't have "status", this filter is ignored below
      },
      include: [
        {
          model: OrderItem,
          required: false,
          include: [{ model: MenuItem, required: false, attributes: ["id", "price"] }],
        },
      ],
      transaction: t,
    });

    // compute totals defensively
    let paidOrders = 0;
    let grossPaid = 0;

    for (const o of orders) {
      const hasStatus = Object.prototype.hasOwnProperty.call(o.dataValues, "status");
      const ok =
        !hasStatus || // if there's no status column we accept the order
        (o.status && DONE_STATUSES.includes(String(o.status).toLowerCase()));

      if (!ok) continue;

      // preferred: sum from line items
      const items = Array.isArray(o.OrderItems) ? o.OrderItems : [];
      let fromLines = 0;
      for (const it of items) {
        const qty =
          Number(it?.quantity ?? it?.OrderItem?.quantity ?? 0) || 0;
        const price =
          Number(it?.MenuItem?.price ?? it?.price ?? 0) || 0;
        fromLines += qty * price;
      }

      // fallback 1: if your Order has totalAmount, use it
      let orderAmount = fromLines;
      if (orderAmount === 0 && Object.prototype.hasOwnProperty.call(o.dataValues, "totalAmount")) {
        orderAmount = Number(o.totalAmount || 0);
      }

      // fallback 2: if your Order has `amount` or `total`, try those
      if (orderAmount === 0 && Object.prototype.hasOwnProperty.call(o.dataValues, "amount")) {
        orderAmount = Number(o.amount || 0);
      }
      if (orderAmount === 0 && Object.prototype.hasOwnProperty.call(o.dataValues, "total")) {
        orderAmount = Number(o.total || 0);
      }

      grossPaid += orderAmount;
      paidOrders += 1;
    }

    // Commission math
    const COMMISSION_PCT = Number(process.env.COMMISSION_PCT || 0.15);
    const commission = +(grossPaid * COMMISSION_PCT).toFixed(2);
    const netOwed = +(grossPaid - commission).toFixed(2);

    await t.commit();
    return res.json({
      vendorId: idNum,
      paidOrders,
      grossPaid: +grossPaid.toFixed(2),
      commission,
      netOwed,
    });
  } catch (e) {
    try { await t.rollback(); } catch {}
    // Return a safe payload instead of a 500 so the UI doesn’t spam errors
    console.error("PAYOUTS summary error:", e?.message);
    return res.status(200).json({
      vendorId: Number(req.params.id) || null,
      paidOrders: 0,
      grossPaid: 0,
      commission: 0,
      netOwed: 0,
      _warning: "Payouts summary fallback used: " + (e?.message || "unknown error"),
    });
  }
});

module.exports = router;