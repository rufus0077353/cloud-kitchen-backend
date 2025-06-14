const express = require("express");
const router = express.Router();

router.get("/ping", (req, res) => {
  console.log("✅ /api/auth/ping route hit");
  res.send("pong!");
});

module.exports = router;