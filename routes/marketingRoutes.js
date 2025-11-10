// routes/marketingRoutes.js
const express = require("express");
const router = express.Router();

const { unsubscribeByToken } = require("../services/marketingService");

router.get("/unsubscribe/:token", async (req, res) => {
  try {
    const result = await unsubscribeByToken(req.params.token);
    res.json({ ok: true, message: "Unsubscribed successfully" });
  } catch (err) {
    console.error("Unsubscribe error:", err);
    res.status(400).json({ ok: false, message: err.message });
  }
});

module.exports = router;