
const express = require("express");
const router = express.Router();
const { Vendor, MenuItem, User } = require("../models");
const { authenticateToken } = require("../middleware/authMiddleware");
const ensureVendorProfile = require("../middleware/ensureVendorProfile");

// 🔹 CREATE Vendor
router.post("/", async (req, res) => {
  const { name, location, cuisine, UserId } = req.body;
  console.log("📥 Create Vendor Request:", req.body);

  if (!name || !location || !cuisine || !UserId) {
    return res.status(400).json({ message: "Name, location, cuisine, and UserId are required" });
  }

  try {
    const vendor = await Vendor.create({ name, location, cuisine, UserId });
    res.status(201).json({ message: "Vendor created", vendor });
  } catch (err) {
    console.error("❌ Error creating vendor:", err);
    res.status(500).json({ message: "Error creating vendor", error: err.message });
  }
});

// 🔹 GET All Vendors
router.get("/", async (req, res) => {
  try {
    const vendors = await Vendor.findAll();
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendors", error: err.message });
  }
});

// 🔹 GET Vendor by ID
router.get("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendor", error: err.message });
  }
});

// 🔹 UPDATE Vendor
router.put("/:id", async (req, res) => {
  const { name, cuisine, location } = req.body;

  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    vendor.name = name || vendor.name;
    vendor.cuisine = cuisine || vendor.cuisine;
    vendor.location = location || vendor.location;

    await vendor.save();

    res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    res.status(500).json({ message: "Error updating vendor", error: err.message });
  }
});

router.get("/:id/menu", async (req, res) => {
  try {
    const items = await MenuItem.findAll({ where: { VendorId: req.params.id } });
    res.json(items); // must be an array
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor menu", error: err.message });
  }
});

// 🔹 DELETE Vendor (Hard Delete)
router.delete("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    await vendor.destroy();
    res.json({ message: "Vendor deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting vendor", error: err.message });
  }
});

// 🔹 GET Menu Items by Vendor
router.get("/:vendorId/menu", async (req, res) => {
  try {
    const menuItems = await MenuItem.findAll({
      where: { VendorId: req.params.vendorId }
    });
    res.json(menuItems);
  } catch (err) {
    res.status(500).json({ message: "Error fetching menu items", error: err.message });
  }
});

router.get("/me", authenticateToken, requireVendor, ensureVendorProfile,(req,res) => {
  res.json({ vendorId: req.vendor.id, userId: req.user.id })
});

// 🔹 ADD Menu Item to Vendor
router.post("/:vendorId/menu", async (req, res) => {
  const { name, price, description } = req.body;
  const { vendorId } = req.params;

  if (!name || !price) {
    return res.status(400).json({ message: "Name and price are required" });
  }

  try {
    const menuItem = await MenuItem.create({
      name,
      price,
      description,
      VendorId: vendorId,
    });

    res.status(201).json({ message: "Menu item created", menuItem });
  } catch (err) {
    res.status(500).json({ message: "Error creating menu item", error: err.message });
  }
});

module.exports = router;