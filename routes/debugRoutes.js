// routes/debugRoutes.js
const express = require("express");
const router = express.Router();
const { User } = require("../models");

router.get("/debug-user", async (req, res) => {
  try {
    const email = req.query.email?.trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email required" });

    const user = await User.findOne({ where: { email } });
    if (!user) return res.json({ found: false });

    res.json({
      found: true,
      id: user.id,
      email: user.email,
      role: user.role,
      passwordHead: user.password.slice(0, 10), // just to check hash
    });
  } catch (err) {
    res.status(500).json({ message: "Error", error: err.message });
  }
});

module.exports = router;