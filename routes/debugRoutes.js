
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