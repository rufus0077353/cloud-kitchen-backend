
const express = require("express");
const router = express.Router();
const db = require("../models");

// ✅ List all tables
router.get("/tables", async (req, res) => {
  try {
    const [results] = await db.sequelize.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug/list-users
 * List first few users (id, name, email, role)
 */
router.get("/list-users", async (_req, res) => {
  try {
    const rows = await db.User.findAll({
      limit: 20,
      order: [["id", "ASC"]],
      attributes: ["id", "name", "email", "role", "createdAt"]
    });
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    res.status(500).json({ message: "list-users failed", error: err.message });
  }
});

/**
 * GET /api/debug/check-user?email=...&password=optional
 * Looks up a user by email and (optionally) checks the password.
 */
router.get("/check-user", async (req, res) => {
  try {
    const { email, password } = req.query;
    if (!email) return res.status(400).json({ message: "email is required" });

    const user = await db.User.findOne({ where: { email } });
    if (!user) return res.json({ found: false, message: "User not found" });

    let passwordMatch = "not tested";
    if (typeof password === "string") {
      passwordMatch = await bcrypt.compare(password, user.password);
    }

    res.json({
      found: true,
      id: user.id,
      email: user.email,
      role: user.role,
      passwordStored: user.password.startsWith("$2") ? "hashed ✅" : "plain ❌",
      passwordMatch
    });
  } catch (err) {
    res.status(500).json({ message: "check-user failed", error: err.message });
  }
});

/**
 * POST /api/debug/seed-user
 * Body: { name, email, password, role }
 * Creates a user only if it doesn't exist. Your User model hashes on save.
 */
router.post("/seed-user", express.json(), async (req, res) => {
  try {
    const {
      name = "Test User",
      email,
      password = "Password123",
      role = "user"
    } = req.body || {};
    if (!email) return res.status(400).json({ message: "email required" });

    let user = await db.User.findOne({ where: { email } });
    if (user) {
      return res.json({
        created: false,
        message: "User already exists",
        id: user.id,
        email: user.email,
        role: user.role
      });
    }

    user = await db.User.create({ name, email, password, role });
    res.status(201).json({
      created: true,
      id: user.id,
      email: user.email,
      role: user.role
    });
  } catch (err) {
    res.status(500).json({ message: "seed-user failed", error: err.message });
  }
});


// ✅ Show row counts in each table
router.get("/table-counts", async (req, res) => {
  try {
    const [results] = await db.sequelize.query(`
      SELECT relname AS table, n_live_tup AS approx_rows
      FROM pg_stat_user_tables
      ORDER BY relname;
    `);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ✅ Peek at first rows of Users (optional)
router.get("/users-preview", async (req, res) => {
  try {
    const [rows] = await db.sequelize.query(`SELECT * FROM "Users" LIMIT 5;`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;