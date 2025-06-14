const express = require("express");
const router = express.Router();
const { User, Vendor, Order, MenuItem } = require("../models");
const { authenticateToken, requireAdmin } = require("../middleware/authMiddleware");
const { Op } = require("sequelize");
const { Sequelize } = require("sequelize");


// Overview dashboard stats
router.get("/overview", async (req, res) => {
  try {
    const totalUsers = await User.count();
    const totalVendors = await Vendor.count();
    const totalOrders = await Order.count();
    const totalRevenue = await Order.sum("totalAmount");
    


    res.json({
      totalUsers,
      totalVendors,
      totalOrders,
      totalRevenue,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch overview", error: err.message });
  }
});


router.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ["id", "name", "email", "role"]
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users", error: err.message });
  }
});


router.get("/test", (req, res)  =>{
    res.send("Admin route is working");
});


// GET /api/admin/orders - Admin filtered orders
router.get("/orders", authenticateToken, requireAdmin, async (req, res) => {
  const { UserId, VendorId, status, startDate, endDate } = req.query;

  const whereClause = {};
  if (UserId) whereClause.UserId = UserId;
  if (VendorId) whereClause.VendorId = VendorId;
  if (status) whereClause.status = status;
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt[Op.gte] = new Date(startDate);
    if (endDate) whereClause.createdAt[Op.lte] = new Date(endDate);
  }

  try {
    const orders = await Order.findAll({
      where: whereClause,
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Vendor, attributes: ["id", "name", "cuisine"] },
        {
          model: MenuItem,
          attributes: ["id", "name", "price"],
          through: { attributes: ["quantity"] },
        }
      ],
      order: [["createdAt", "DESC"]],
    });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch orders", error: err.message });
  }
});

router.get("/insights", authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Orders per day (last 7 days)
    const recentOrders = await Order.findAll({
      attributes: [
        [Sequelize.fn("DATE", Sequelize.col("createdAt")), "date"],
        [Sequelize.fn("COUNT", Sequelize.col("id")), "orderCount"],
        [Sequelize.fn("SUM", Sequelize.col("totalAmount")), "totalRevenue"]
      ],
      group: [Sequelize.fn("DATE", Sequelize.col("createdAt"))],
      order: [[Sequelize.fn("DATE", Sequelize.col("createdAt")), "DESC"]],
      limit: 7
    });

    // Top-selling items
    const topItems = await MenuItem.findAll({
      attributes: [
        "id", "name",
        [Sequelize.fn("SUM", Sequelize.col("OrderItem.quantity")), "totalSold"]
      ],
      include: [{
        model: Order,
        attributes: [],
        through: { attributes: ["quantity"] }
      }],
      group: ["MenuItem.id"],
      order: [[Sequelize.literal("totalSold"), "DESC"]],
      limit: 5
    });

    res.json({ recentOrders, topItems });
  } catch (err) {
    res.status(500).json({ message: "Failed to load insights", error: err.message });
  }
});

// create a user (admin only)
router.post("/users", authenticateToken, requireAdmin, async (req,res) => {
    const { name, email, password, role} = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({ message: "All fields are required "});
    }

    try{
        const existing = await User.findOne({ where: { email } });
        if (existing) {
            return res.status(400).json({ message: "Email already in use"});
        }

        const user = await User.create({ name, email, password, role });
        res.status(201).json({
            message: "User created succesfully",
            user: { id: user.id, name: user.name, email: user,email, role: user.role }
        });
    } catch (err) {
        res.status(500).json({ message: "Failed to create user", error: err.message});
    }
});


router.post(
  "/register",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }

    try {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ message: "User already exists" });
      }

      const newUser = await User.create({ name, email, password, role });

      res.status(201).json({
        message: "User created successfully",
        user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
      });
    } catch (err) {
      res.status(500).json({ message: "Error creating user", error: err.message });
    }
  }
);

//DELETE /api/admin/users/:id - Delete a user (admin only)
router.delete("/users/:id", authenticateToken, requireAdmin, async (req, res) =>{
    const userId = req.params.id;

    try{
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json ({ message: "User not found" });
        }

        await user.destroy();
        res.json({ message: "User deleted succesfully"});
    }   catch (err){
        res.status(500).json({ message: "Failed to delete user", error: err.message});
    }
});

// PUT /api/admin/users/:id/role - Update user role
router.put("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, role } = req.body;

  try {
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update fields
    user.name = name || user.name;
    user.email = email || user.email;
    user.role = role || user.role;

    await user.save();

    res.json({ message: "User updated successfully", user });
  } catch (err) {
    res.status(500).json({ message: "Failed to update user", error: err.message });
  }
});


//promote a user to vendor
router.put("/promote/:id", authenticateToken, requireAdmin, async (req, res) => {
    try{
        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found"});

        user.role = "vendor";
        await user.save();
        res.json({ message: "User promoted to vendor successfully", user });
    }   catch (err) {
        res.status(500).json({ message: "Failed to promote user", error: err.message });
    }
});

// routes/adminRoutes.js (or a new vendorRoutes.js)
router.post("/promote-to-vendor", authenticateToken, requireAdmin, async (req, res) => {
  const { userId, name, cuisine } = req.body;

  if (!userId || !name || !cuisine) {
    return res.status(400).json({ message: "userId, name, and cuisine are required" });
  }

  try {
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Update user role to vendor
    user.role = "vendor";
    await user.save();

    // Create vendor entry
    const vendor = await Vendor.create({ name, cuisine, UserId: user.id });

    res.status(201).json({ message: "User promoted to vendor", vendor });
  } catch (err) {
    res.status(500).json({ message: "Error promoting user", error: err.message });
  }
});

// ✅ Get All Vendors

router.get("/vendors", authenticateToken, requireAdmin, async (req, res) => {

  try {

    const vendors = await Vendor.findAll();

    res.json(vendors);

  } catch (err) {

    res.status(500).json({ message: "Failed to fetch vendors", error: err.message });

  }

});



// ✅ Create Vendor

router.post("/vendors", authenticateToken, requireAdmin, async (req, res) => {

  try {

    const { name, cuisine } = req.body;

    if (!name || !cuisine) {

      return res.status(400).json({ message: "Name and cuisine are required" });

    }

    const newVendor = await Vendor.create({ name, cuisine });

    res.status(201).json(newVendor);

  } catch (err) {

    res.status(500).json({ message: "Failed to create vendor", error: err.message });

  }

});



// ✅ Update Vendor

router.put("/vendors/:id", authenticateToken, requireAdmin, async (req, res) => {

  try {

    const vendor = await Vendor.findByPk(req.params.id);

    if (!vendor) return res.status(404).json({ message: "Vendor not found" });



    const { name, cuisine } = req.body;

    vendor.name = name || vendor.name;

    vendor.cuisine = cuisine || vendor.cuisine;

    await vendor.save();



    res.json({ message: "Vendor updated successfully", vendor });

  } catch (err) {

    res.status(500).json({ message: "Failed to update vendor", error: err.message });

  }

});



// ✅ Delete Vendor

router.delete("/vendors/:id", authenticateToken, requireAdmin, async (req, res) => {

  try {

    const vendor = await Vendor.findByPk(req.params.id);

    if (!vendor) return res.status(404).json({ message: "Vendor not found" });



    await vendor.destroy();

    res.json({ message: "Vendor deleted successfully" });

  } catch (err) {

    res.status(500).json({ message: "Failed to delete vendor", error: err.message });

  }

});



module.exports = router;
