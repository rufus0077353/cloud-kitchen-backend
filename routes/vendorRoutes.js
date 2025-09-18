
// routes/vendorRoutes.js
const express = require("express");
const router = express.Router();

const { Op } = require("sequelize");
const { Vendor, MenuItem, Order } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

/* ----------------- WHO AM I ----------------- */
router.get(
  "/me",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const v = await Vendor.findByPk(req.vendor.id, {
        attributes: ["id", "UserId", "isOpen", "name", "location", "cuisine", "phone", "logoUrl"],
      });
      if (!v) return res.status(404).json({ message: "Vendor profile not found" });
      res.json({ vendorId: v.id, userId: req.user.id, ...v.toJSON() });
    } catch (e) {
      res.status(500).json({ message: "Failed to load vendor profile", error: e.message });
    }
  }
);

/* ----------------- TOGGLE OPEN/CLOSED ----------------- */
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

      // Broadcast status change
      const io = req.app.get("io");
      if (io) io.emit("vendor:status", { vendorId: vendor.id, isOpen: vendor.isOpen });

      return res.json({ message: "Vendor status updated", vendor });
    } catch (err) {
      return res.status(500).json({ message: "Failed to update vendor status", error: err.message });
    }
  }
);

/* ----------------- ALL VENDORS (PUBLIC) ----------------- */
router.get("/", async (_req, res) => {
  try {
    const vendors = await Vendor.findAll({
      attributes: ["id", "name", "location", "cuisine", "isOpen", "phone", "logoUrl"],
      order: [["createdAt", "DESC"]],
    });
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendors", error: err.message });
  }
});

/* ----------------- CREATE VENDOR ----------------- */
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name, location, cuisine, UserId, phone, logoUrl } = req.body;
    if (!name || !location || !cuisine) {
      return res.status(400).json({ message: "Name, location, and cuisine are required" });
    }

    const vendor = await Vendor.create({
      name,
      location,
      cuisine,
      UserId: UserId || req.user.id, // auto-link if not provided
      isOpen: true,
      phone: phone || null,
      logoUrl: logoUrl || null,
    });

    res.status(201).json({ message: "Vendor created", vendor });
  } catch (err) {
    res.status(500).json({ message: "Error creating vendor", error: err.message });
  }
});

/* ----------------- VENDOR MENU (PUBLIC) ----------------- */
router.get("/:id/menu", async (req, res) => {
  try {
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum)) {
      return res.status(400).json({ message: "Invalid vendor id" });
    }

    const vendor = await Vendor.findByPk(idNum, { attributes: ["id", "isOpen"] });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const items = await MenuItem.findAll({
      where: { VendorId: idNum, isAvailable: true },
      order: [["createdAt", "DESC"]],
    });

    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor menu", error: err.message });
  }
});

/* ----------------- GET VENDOR BY ID (PUBLIC) ----------------- */
router.get("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id, {
      attributes: ["id", "name", "location", "cuisine", "isOpen", "phone", "logoUrl"],
    });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendor", error: err.message });
  }
});

/* ----------------- UPDATE VENDOR ----------------- */
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { name, cuisine, location, isOpen, phone, logoUrl } = req.body;
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    vendor.name = name ?? vendor.name;
    vendor.cuisine = cuisine ?? vendor.cuisine;
    vendor.location = location ?? vendor.location;
    vendor.phone = phone ?? vendor.phone;
    vendor.logoUrl = logoUrl ?? vendor.logoUrl;
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

/* ----------------- DELETE VENDOR ----------------- */
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

/* ----------------- PAYOUTS (ALIASES FOR FRONTEND) ----------------- */
/* GET /api/vendors/:vendorId/payouts  -> same summary your UI expects */
router.get(
  "/:vendorId/payouts",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    try {
      const vendorId = Number(req.params.vendorId);
      if (!Number.isFinite(vendorId)) {
        return res.status(400).json({ message: "Invalid vendor id" });
      }

      // authorize: must be this vendor or admin
      const isAuthorized = req.vendor?.id === vendorId || req.user?.role === "admin";
      if (!isAuthorized) return res.status(403).json({ message: "Not authorized" });

      const { from, to } = req.query;
      const where = {
        VendorId: vendorId,
        status: { [Op.notIn]: ["rejected", "canceled"] },
      };
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt[Op.gte] = new Date(from);
        if (to)   where.createdAt[Op.lte] = new Date(to);
      }

      const COMMISSION_PCT = Number(process.env.COMMISSION_PCT || 0.15);

      const grossPaid =
        (await Order.sum("totalAmount", { where: { ...where, paymentStatus: "paid" } })) || 0;
      const paidOrders = await Order.count({
        where: { ...where, paymentStatus: "paid" },
      });
      const unpaidGross =
        (await Order.sum("totalAmount", {
          where: { ...where, paymentStatus: { [Op.ne]: "paid" } },
        })) || 0;

      const commission = +(grossPaid * COMMISSION_PCT).toFixed(2);
      const netOwed = +(grossPaid - commission).toFixed(2);

      return res.json({
        vendorId,
        dateRange: { from: from || null, to: to || null },
        rate: COMMISSION_PCT,
        paidOrders,
        grossPaid: +grossPaid.toFixed(2),
        commission,
        netOwed,
        grossUnpaid: +unpaidGross.toFixed(2),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Failed to build payouts summary", error: err.message });
    }
  }
);

/* Optional: GET /api/vendors/me/payouts */
router.get(
  "/me/payouts",
  authenticateToken,
  requireVendor,
  ensureVendorProfile,
  async (req, res) => {
    req.params.vendorId = String(req.vendor.id);
    return router.handle(req, res); // reuse the handler above
  }
);

module.exports = router;