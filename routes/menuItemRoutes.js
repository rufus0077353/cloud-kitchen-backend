
const express = require("express");
const router = express.Router();
const { MenuItem } = require("../models");

// ✅ GET all menu items
router.get("/", async (req, res) => {
  try {
    const items = await MenuItem.findAll();
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch menu items", error: err.message });
  }
});

// ✅ CREATE a new menu item
router.post("/", async (req, res) => {
  const { name, price, description, VendorId } = req.body;

  if (!name || !price || !VendorId) {
    return res.status(400).json({ message: "Name, price, and VendorId are required" });
  }

  try {
    const item = await MenuItem.create({ name, price, description, VendorId });
    res.status(201).json({ message: "Menu item created", item });
  } catch (err) {
    res.status(500).json({ message: "Failed to create menu item", error: err.message });
  }
});

// ✅ UPDATE a menu item
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, price, description, VendorId } = req.body;

  try {
    const item = await MenuItem.findByPk(id);
    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    item.name = name ?? item.name;
    item.price = price ?? item.price;
    item.description = description ?? item.description;
    item.VendorId = VendorId ?? item.VendorId;

    await item.save();
    res.json({ message: "Menu item updated", item });
  } catch (err) {
    res.status(500).json({ message: "Failed to update menu item", error: err.message });
  }
});

// ✅ DELETE a menu item
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const item = await MenuItem.findByPk(id);
    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    await item.destroy();
    res.json({ message: "Menu item deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete menu item", error: err.message });
  }
});

module.exports = router;