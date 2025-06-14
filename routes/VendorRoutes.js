const express = require("express");
const router = express.Router();
const { Vendor, MenuItem, User } = require("../models");

// CREATE a vendor
router.post("/", async (req, res) => {
  const { name, location, cuisine, UserId } = req.body;

  console.log("Request Body:", req.body);

  if (!name || !location ||!cuisine ||!UserId) {
    return res.status(400).json({ message: "Name, location, cuisine, and UserId are required" });
  }

  try {
    const vendor = await Vendor.create({ name, location, cuisine, UserId });
    res.status(201).json(vendor);
  } catch (err) {
    console.error("Error creating vendor:", err);
    res.status(500).json({ message: "Error creating vendor", error: err.message });
  }
});

// READ all non-deleted vendors
router.get("/", async (req, res) => {
  try {
    const vendors = await Vendor.findAll();
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendors", error: err.message });
  }
});

// READ vendor by ID
router.get("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: "Error fetching vendor", error: err.message });
  }
});

// UPDATE vendor
router.put("/:id", async (req, res) => {
  try {
    const { name, cuisine } = req.body;
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor || vendor.isDeleted) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    vendor.name = name || vendor.name;
    vendor.cuisine = cuisine || vendor.cuisine;
    await vendor.save();

    res.json({ message: "Vendor updated", vendor });
  } catch (err) {
    res.status(500).json({ message: "Error updating vendor", error: err.message });
  }
});


// SOFT DELETE vendor
router.patch("/:id/delete", async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor || vendor.isDeleted) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    await vendor.destroy();

    res.json({ message: "Vendor soft deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting vendor", error: err.message });
  }
});


// routes/vendorRoutes.js
router.delete("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    await vendor.destroy();
    res.json({ message: "Vendor deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting vendor", error: err.message });
  }
});


// routes/vendorRoutes.js
router.get("/:vendorId/menu", async (req, res) => {
  const { vendorId } = req.params;
  try {
    const menuItems = await MenuItem.findAll({
      where: { VendorId: vendorId },
    });
    res.json(menuItems);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch menu", error: err.message });
  }
});



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