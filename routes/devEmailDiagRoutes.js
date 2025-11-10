const express = require("express");
const router = express.Router();
const mailer = require("../utils/mailer");

router.get("/diag", (req, res) => {
  res.json({
    provider: mailer.__diag.provider(),
    isProd: mailer.__diag.isProd(),
    from: mailer.__diag.from(),
    keyLen: mailer.__diag.keyLen(),     // length only, not the key
    keyPreview: mailer.__diag.keyPreview()
  });
});

module.exports = router;