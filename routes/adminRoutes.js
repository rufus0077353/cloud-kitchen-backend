
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { User, Vendor, Order, MenuItem } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");
const { Op, Sequelize } = require("sequelize");

const DEFAULT_PLATFORM_RATE = Number(process.env.PLATFORM_RATE || 0.15); // 15%

/* ----------------- helpers ----------------- */
function normalizeOrderFilters(req) {
  // accept from either query (GET) or body (POST)
  const src = req.method === "GET" ? (req.query || {}) : (req.body || {});
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

const money = (n) => Number((Number(n || 0)).toFixed(2));
const commissionFor = (orderPlain) => {
  const total = Number(orderPlain?.totalAmount || 0);
  const rate =
    orderPlain?.Vendor?.commissionRate != null
      ? Number(orderPlain.Vendor.commissionRate)
      : DEFAULT_PLATFORM_RATE;
  return money(total * (isFinite(rate) ? rate : DEFAULT_PLATFORM_RATE));
};

/* ----------------- overview (adds commission totals) ----------------- */
router.get("/overview", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const [totalUsers, totalVendors, totalOrders, totalRevenueRaw] = await Promise.all([
      User.count(),
      Vendor.count(),
      Order.count(),
      Order.sum("totalAmount"),
    ]);

    // Only paid & not canceled/rejected count towards commission
    const paidWhere = {
      paymentStatus: "paid",
      status: { [Op.notIn]: ["rejected", "canceled", "cancelled"] },
    };

    const paidOrders = await Order.findAll({
      where: paidWhere,
      include: [{ model: Vendor, attributes: ["id", "commissionRate"] }],
      attributes: ["id", "totalAmount", "VendorId", "createdAt"],
      order: [["createdAt", "DESC"]],
      raw: true,
      nest: true,
    });

    const totalCommission = paidOrders.reduce((sum, o) => sum + commissionFor(o), 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthCommission = paidOrders
      .filter((o) => new Date(o.createdAt) >= monthStart)
      .reduce((sum, o) => sum + commissionFor(o), 0);

    res.json({
      totalUsers,
      totalVendors,
      totalOrders,
      totalRevenue: money(totalRevenueRaw || 0),
      totalCommission: money(totalCommission),
      monthCommission: money(monthCommission),
    });
  } catch (err) {
    console.error("overview error:", err);
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
  const { name, cuisine, commissionRate } = req.body || {};
  if (!name || !cuisine) return res.status(400).json({ message: "Name and cuisine are required" });

  try {
    const newVendor = await Vendor.create({
      name,
      cuisine,
      commissionRate: commissionRate != null ? Number(commissionRate) : undefined,
    });
    res.status(201).json({ message: "Vendor created", newVendor });
  } catch (err) {
    res.status(500).json({ message: "Vendor creation failed", error: err.message });
  }
});

router.put("/vendors/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const { name, cuisine, commissionRate } = req.body || {};
    if (name) vendor.name = name;
    if (cuisine) vendor.cuisine = cuisine;
    if (commissionRate != null && commissionRate !== "") {
      vendor.commissionRate = Number(commissionRate);
    }

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

/* ----------------- orders (admin filters + commission) ----------------- */
// GET with querystring OR POST with JSON body both support: UserId, VendorId, status, startDate/From, endDate/To
router.get("/orders", authenticateToken, requireAdmin, async (req, res) => {
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

    // attach commission
    const data = orders.map((o) => {
      const plain = o.toJSON();
      plain.commission = commissionFor(plain);
      return plain;
    });

    res.json(data);
  } catch (err) {
    console.error("ADMIN /orders failed:", err);
    res.status(500).json({ message: "Orders fetch failed", error: err.message });
  }
});

// POST alias (same behavior as GET)
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

    const data = orders.map((o) => {
      const plain = o.toJSON();
      plain.commission = commissionFor(plain);
      return plain;
    });

    res.json(data);
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