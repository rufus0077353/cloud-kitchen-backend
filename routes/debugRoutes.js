
const express = require("express");
const bcrypt = require("bcrypt");
const { User } = require("../models");

const router = express.Router();

router.get("/check-user", async (req, res) => {
  try {
    const { email, password } = req.query;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.json({ found: false, message: "User not found" });
    }

    let passwordMatch = null;
    if (password) {
      passwordMatch = await bcrypt.compare(password, user.password);
    }

    return res.json({
      found: true,
      id: user.id,
      email: user.email,
      role: user.role,
      passwordStored: user.password.startsWith("$2b$")
        ? "hashed ✅"
        : "not hashed ❌",
      passwordMatch: password !== undefined ? passwordMatch : "not tested",
    });
  } catch (err) {
    console.error("debug error:", err);
    res.status(500).json({ message: "Debug failed", error: err.message });
  }
});

module.exports = router;