const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const mime = require("mime-types");
const { authenticateToken, requireVendor } = require("../middleware/authMiddleware");

const router = express.Router();

// ensure uploads dir exists
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// storage: keep original extension, unique filename
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = mime.extension(file.mimetype) || "bin";
    const safeBase = (file.originalname || "file").replace(/[^a-z0-9_\-\.]/gi, "_");
    const stamp = Date.now();
    cb(null, `${stamp}-${safeBase}.${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ok = ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.mimetype);
  cb(ok ? null : new Error("Only JPG/PNG/WEBP/AVIF allowed"), ok);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});

// POST /api/uploads (vendor-authenticated)
router.post(
  "/",
  authenticateToken,
  requireVendor,
  upload.single("image"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    // public URL (index mounts static /uploads)
    const publicUrl = `/uploads/${req.file.filename}`;
    res.status(201).json({ url: publicUrl });
  }
);

module.exports = router;