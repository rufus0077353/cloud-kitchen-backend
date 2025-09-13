// routes/uploadRoutes.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const router = express.Router();

// Ensure uploads dir exists
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Only allow common image types
const fileFilter = (req, file, cb) => {
  const ok = ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
    file.mimetype.toLowerCase()
  );
  cb(ok ? null : new Error("Only JPG/PNG/WEBP images are allowed"), ok);
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || ".jpg").toLowerCase();
    const base = path.basename(file.originalname || "image", ext).slice(0, 40);
    cb(null, `${Date.now()}-${base.replace(/\s+/g, "-")}${ext}`);
  },
});

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/uploads  (form-data; field name: "image")
router.post("/", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No image uploaded" });
  // Public URL served by /uploads static (see index.js)
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

module.exports = router;