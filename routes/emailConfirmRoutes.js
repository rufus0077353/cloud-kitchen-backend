// src/routes/emailConfirmRoutes.js
const express = require ("express");
const { verifyConfirmToken } = require ("../services/emailConfirm");

const r = express.Router();
r.get("/verify-email", async (req, res) => {
  try {
    await verifyConfirmToken(req.query.token);
    // redirect to app success page
    res.redirect(`${process.env.APP_BASE_URL}/email-verified`);
  } catch (e) {
    res.redirect(`${process.env.APP_BASE_URL}/email-verify-error?m=${encodeURIComponent(e.message)}`);
  }
});
