const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { User, Vendor, Order, MenuItem } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");
const { Op, Sequelize } = require("sequelize");

/* ----------------- helpers ----------------- */
function normalizeOrderFilters(req) {
  // accept from either query (GET) or body (POST)
  const src = req.method === "GET" ? req.query : (req.body || {});
  // accept both lower & UPPER case keys
  const val = (a, b) => (src[a] ?? src[b] ?? "").toString().trim();

  const UserId   = val("UserId",   "userId");
  const VendorId = val("VendorId", "vendorId");
  const status   = val("status",   "Status");

  // date keys accepted: startDate/endDate OR From/To
  const startRaw = val("startDate", "From");
  const endRaw   = val("endDate",   "To");

  const where = {};
  if (UserId)   where.UserId   = Number(UserId);
  if (VendorId) where.VendorId = Number(VendorId);
  if (status)   where.status   = status;

  if (startRaw || endRaw) {
    where.createdAt = {};
    if (startRaw) where.createdAt[Op.gte] = new Date(startRaw);
    if (endRaw)   where.createdAt[Op.lte] = new Date(endRaw);
  }
  return where;
}

/* ----------------- overview ----------------- */
router.get("/overview", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const totalUsers   = await User.count();
    const totalVendors = await Vendor.count();
    const totalOrders  = await Order.count();
    const totalRevenue = await Order.sum("totalAmount");
    res.json({ totalUsers, totalVendors, totalOrders, totalRevenue });
  } catch (err) {
    res.status(500).json({ message: "Overview fetch failed", error: err.message });
  }
});

/* ----------------- users ----------------- */
router.get("/users", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const users = await User.findAll({ attributes: ["id", "name", "email", "role"] });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Users fetch failed", error: err.message });
  }
});

router.post("/users", authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "All fields are required" });
  }
  try {
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(409).json({ message: "Email already in use" });

    const user = await User.create({ name, email, password, role });
    res.status(201).json({ message: "User created", user });
  } catch (err) {
    res.status(500).json({ message: "User creation failed", error: err.message });
  }
});

router.put("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.name = name || user.name;
    user.email = email || user.email;
    user.role = role || user.role;
    if (password) user.password = await bcrypt.hash(password, 10);

    await user.save();
    res.json({ message: "User updated successfully", user });
  } catch (err) {
    res.status(500).json({ message: "Failed to update user", error: err.message });
  }
});

router.delete("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    await user.destroy();
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: "User deletion failed", error: err.message });
  }
});

/* ----------------- promote ----------------- */
router.put("/promote/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.role = "vendor";
    await user.save();

    res.json({ message: "User promoted to vendor successfully", user });
  } catch (err) {
    res.status(500).json({ message: "Failed to promote user", error: err.message });
  }
});

/* ----------------- vendors ----------------- */
router.get("/vendors", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const vendors = await Vendor.findAll();
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: "Vendors fetch failed", error: err.message });
  }
});

router.post("/vendors", authenticateToken, requireAdmin, async (req, res) => {
  const { name, cuisine } = req.body || {};
  if (!name || !cuisine) return res.status(400).json({ message: "Name and cuisine are required" });

  try {
    const newVendor = await Vendor.create({ name, cuisine });
    res.status(201).json({ message: "Vendor created", newVendor });
  } catch (err) {
    res.status(500).json({ message: "Vendor creation failed", error: err.message });
  }
});

router.put("/vendors/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const { name, cuisine } = req.body || {};
    vendor.name = name || vendor.name;
    vendor.cuisine = cuisine || vendor.cuisine;

    await vendor.save();
    res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    res.status(500).json({ message: "Vendor update failed", error: err.message });
  }
});

router.delete("/vendors/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    await vendor.destroy();
    res.json({ message: "Vendor deleted" });
  } catch (err) {
    res.status(500).json({ message: "Vendor deletion failed", error: err.message });
  }
});

/* ----------------- orders (admin filters) ----------------- */

// Orders (admin filters)
router.get("/orders", authenticateToken, requireAdmin, async (req, res) => {
  try {
    // accept both lower/upper case from FE
    const q = req.query || {};
    const UserId   = q.UserId ?? q.userId ?? undefined;
    const VendorId = q.VendorId ?? q.vendorId ?? undefined;
    const status   = q.status ?? undefined;
    const start    = q.startDate ?? q.from ?? undefined;
    const end      = q.endDate   ?? q.to   ?? undefined;

    const where = {};
    if (UserId)   where.UserId = UserId;
    if (VendorId) where.VendorId = VendorId;
    if (status)   where.status = status;

    // date filters (ignore invalid)
    if (start || end) {
      const createdAt = {};
      if (start) {
        const d = new Date(start);
        if (!isNaN(d)) createdAt[Op.gte] = d;
      }
      if (end) {
        // include full end day
        const d = new Date(end);
        if (!isNaN(d)) {
          d.setHours(23, 59, 59, 999);
          createdAt[Op.lte] = d;
        }
      }
      if (Object.keys(createdAt).length) where.createdAt = createdAt;
    }

    const orders = await Order.findAll({
      where,
      include: [
        { model: User,   attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine", "commissionRate"] },
        { model: MenuItem, attributes: ["id", "name", "price"], through: { attributes: ["quantity"] } },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.json(Array.isArray(orders) ? orders : []);
  } catch (err) {
    console.error("ADMIN /orders failed:", err);
    return res.status(500).json({ message: "Orders fetch failed", error: err.message });
  }
});
// POST alias to help older/frontends that send JSON instead of querystring
router.post("/orders", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const where = normalizeOrderFilters(req);
    const orders = await Order.findAll({
      where,
      include: [
        { model: User,   attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine", "commissionRate"] },
        { model: MenuItem, attributes: ["id", "name", "price"], through: { attributes: ["quantity"] } },
      ],
      order: [["createdAt", "DESC"]],
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Orders fetch failed", error: err.message });
  }
});

/* ----------------- insights ----------------- */
router.get("/insights", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const recentOrders = await Order.findAll({
      attributes: [
        [Sequelize.fn("DATE", Sequelize.col("createdAt")), "date"],
        [Sequelize.fn("COUNT", Sequelize.col("id")), "orderCount"],
        [Sequelize.fn("SUM", Sequelize.col("totalAmount")), "totalRevenue"],
      ],
      group: [Sequelize.fn("DATE", Sequelize.col("createdAt"))],
      order: [[Sequelize.fn("DATE", Sequelize.col("createdAt")), "DESC"]],
      limit: 7,
    });

    const topItems = await MenuItem.findAll({
      attributes: ["id", "name", [Sequelize.fn("SUM", Sequelize.col("OrderItem.quantity")), "totalSold"]],
      include: [{ model: Order, attributes: [], through: { attributes: ["quantity"] } }],
      group: ["MenuItem.id"],
      order: [[Sequelize.literal("totalSold"), "DESC"]],
      limit: 5,
    });

    res.json({ recentOrders, topItems });
  } catch (err) {
    res.status(500).json({ message: "Insights fetch failed", error: err.message });
  }
});

module.exports = router;