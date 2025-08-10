
const express = require("express");
const router = express.Router();
const { MenuItem, Vendor } = require("../models");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");

// helper: get vendor record for this user
async function findVendorByUserId(userId) {
  return Vendor.findOne({ where: { UserId: userId } });
}

// GET all menu items for THIS vendor
router.get("/mine", authenticateToken, requireVendor, async (req, res) => {
  try {
    const vendor = await findVendorByUserId(req.user.id);
    if (!vendor) return res.status(404).json({ message: "Vendor profile not found for this user" });

    const items = await MenuItem.findAll({ where: { VendorId: vendor.id } });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch menu items", error: err.message });
  }
});

// CREATE a new menu item (derive VendorId from token)
router.post("/", authenticateToken, requireVendor, async (req, res) => {
  try {
    const vendor = await findVendorByUserId(req.user.id);
    if (!vendor) return res.status(404).json({ message: "Vendor profile not found for this user" });

    const { name, price, description } = req.body;
    if (!name || !price) {
      return res.status(400).json({ message: "Name and price are required" });
    }

    const item = await MenuItem.create({
      name,
      price,
      description,
      VendorId: vendor.id, // <-- from Vendor table
    });

    res.status(201).json({ message: "Menu item created", item });
  } catch (err) {
    res.status(500).json({ message: "Failed to create menu item", error: err.message });
  }
});

// UPDATE a menu item (ownership check)
router.put("/:id", authenticateToken, requireVendor, async (req, res) => {
  try {
    const vendor = await findVendorByUserId(req.user.id);
    if (!vendor) return res.status(404).json({ message: "Vendor profile not found for this user" });

    const item = await MenuItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ message: "Menu item not found" });
    if (item.VendorId !== vendor.id) return res.status(403).json({ message: "Not your menu item" });

    const { name, price, description } = req.body;
    await item.update({ name: name ?? item.name, price: price ?? item.price, description: description ?? item.description });

    res.json({ message: "Menu item updated", item });
  } catch (err) {
    res.status(500).json({ message: "Failed to update menu item", error: err.message });
  }
});

// DELETE a menu item (ownership check)
router.delete("/:id", authenticateToken, requireVendor, async (req, res) => {
  try {
    const vendor = await findVendorByUserId(req.user.id);
    if (!vendor) return res.status(404).json({ message: "Vendor profile not found for this user" });

    const item = await MenuItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ message: "Menu item not found" });
    if (item.VendorId !== vendor.id) return res.status(403).json({ message: "Not your menu item" });

    await item.destroy();
    res.json({ message: "Menu item deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete menu item", error: err.message });
  }
});

module.exports = router;