// routes/adminMaintenance.js
const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const { Vendor, User } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");

// List orphan vendors (UserId is NULL)
router.get("/vendors/orphans", authenticateToken, requireAdmin, async (req, res) => {
  const rows = await Vendor.findAll({
    where: { UserId: { [Op.is]: null } },
    order: [["createdAt", "DESC"]],
  });
  res.json({ count: rows.length, items: rows });
});

// Soft-delete all orphan vendors
router.post("/vendors/orphans/soft-delete", authenticateToken, requireAdmin, async (req, res) => {
  const [affected] = await Vendor.update(
    { isDeleted: true },
    { where: { UserId: { [Op.is]: null } } }
  );
  res.json({ message: "Soft-deleted orphan vendors", affected });
});

// Assign a specific userId to a vendor
router.post("/vendors/:id/assign-user", authenticateToken, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.body?.userId);
  if (!Number.isFinite(id) || !Number.isFinite(userId)) {
    return res.status(400).json({ message: "id and userId must be numbers" });
  }
  const user = await User.findByPk(userId);
  if (!user) return res.status(404).json({ message: "Target user not found" });

  const v = await Vendor.findByPk(id);
  if (!v) return res.status(404).json({ message: "Vendor not found" });

  v.UserId = userId;
  v.isDeleted = false;
  await v.save();
  res.json({ message: "Vendor reassigned", vendor: v });
});

module.exports = router;