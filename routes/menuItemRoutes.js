const express = require("express");
const router = express.Router();
const { MenuItem } = require("../models");

// GET all menu items
router.get("/", async (req, res) => {
  try {
    const items = await MenuItem.findAll();
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Error fetching menu items", error: err.message });
  }
});

router.post("/", async (req, res) => {
 try {
   const { name, price, description, VendorId } = req.body;
   const item = await MenuItem.create({ name, price, description, VendorId });
   res.status(201).json(item);
 } catch (err) {
   res.status(500).json({ error: err.message });
 }
});

// PUT update menu item
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, price, description, VendorId } = req.body;

  try {
    const item = await MenuItem.findByPk(id);
    if (!item) return res.status(404).json({ message: "Menu item not found" });

    item.name = name || item.name;
    item.price = price || item.price;
    item.description = description || item.description;
    item.VendorId = VendorId || item.VendorId;

    await item.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: "Error updating menu item", error: err.message });
  }
});

// DELETE a menu item
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const item = await MenuItem.findByPk(id);
    if (!item) return res.status(404).json({ message: "Menu item not found" });

    await item.destroy();
    res.json({ message: "Menu item deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting menu item", error: err.message });
  }
});



module.exports = router;