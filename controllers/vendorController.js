
// controllers/vendorController.js
const { Vendor, User } = require("../models");

/* ----------------------- list vendors ----------------------- */
// GET /api/vendors?page=1&pageSize=20
exports.list = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.max(parseInt(req.query.pageSize || "20", 10), 1);
    const offset = (page - 1) * pageSize;

    const { rows, count } = await Vendor.findAndCountAll({
      limit: pageSize,
      offset,
      order: [["id", "DESC"]],
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "role"],
          required: false,
        },
      ],
    });

    return res.json({ items: rows, total: count, page, pageSize });
  } catch (err) {
    console.error("vendors.list error:", err);
    return res.status(500).json({ message: "Failed to load vendors" });
  }
};

/* ----------------------- get one ----------------------- */
// GET /api/vendors/:id
exports.getOne = async (req, res) => {
  try {
    const v = await Vendor.findByPk(req.params.id, {
      include: [{ model: User, attributes: ["id", "name", "email", "role"] }],
    });
    if (!v) return res.status(404).json({ message: "Vendor not found" });
    return res.json(v);
  } catch (err) {
    console.error("vendors.getOne error:", err);
    return res.status(500).json({ message: "Failed to load vendor" });
  }
};

/* ----------------------- create ----------------------- */
// POST /api/vendors
// body: { name, location?, cuisine?, phone?, logoUrl?, UserId, isOpen? }
exports.create = async (req, res) => {
  try {
    const { name, UserId } = req.body;
    if (!name || !UserId) {
      return res.status(400).json({ message: "Missing required fields (name, UserId)" });
    }

    const data = {
      name,
      UserId,
      location: req.body.location ?? null,
      cuisine:  req.body.cuisine  ?? null,
      phone:    req.body.phone    ?? null,
      logoUrl:  req.body.logoUrl  ?? null,
      isOpen:   req.body.isOpen === undefined ? true : !!req.body.isOpen,
    };

    const created = await Vendor.create(data);
    return res.status(201).json(created);
  } catch (err) {
    console.error("vendors.create error:", err);
    return res.status(500).json({ message: "Failed to create vendor" });
  }
};

/* ----------------------- update ----------------------- */
// PUT /api/vendors/:id
// body: any of { name, location, cuisine, phone, logoUrl, UserId, isOpen, isDeleted }
exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const v = await Vendor.findByPk(id);
    if (!v) return res.status(404).json({ message: "Vendor not found" });

    const fields = ["name", "location", "cuisine", "phone", "logoUrl", "UserId", "isOpen", "isDeleted"];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        v[f] = f === "isOpen" || f === "isDeleted" ? !!req.body[f] : req.body[f];
      }
    }

    await v.save();
    res.json(v);
  } catch (err) {
    console.error("vendors.update error:", err);
    res.status(500).json({ message: "Failed to update vendor" });
  }
};

/* ----------------------- delete (hard) ----------------------- */
// DELETE /api/vendors/:id
exports.remove = async (req, res) => {
  try {
    const v = await Vendor.findByPk(req.params.id);
    if (!v) return res.status(404).json({ message: "Vendor not found" });

    await v.destroy();
    return res.json({ success: true });
  } catch (err) {
    console.error("vendors.remove error:", err);
    return res.status(500).json({ message: "Failed to delete vendor" });
  }
};