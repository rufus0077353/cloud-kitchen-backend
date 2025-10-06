// scripts/backup-db.js
const fs = require("fs");
const path = require("path");

// Pull in your Sequelize models (adjust the path if your models index is elsewhere)
const models = require("../models");
const {
  sequelize,
  Vendor,
  Order,
  OrderItem,
  MenuItem,
  User,
  Payout, // may be undefined in your project — that's fine
} = models;

(async () => {
  try {
    await sequelize.authenticate();

    // Load raw table rows (no includes; easy to restore/inspect)
    const [vendors, orders, orderItems, menuItems, users, payouts] = await Promise.all([
      Vendor.findAll({ raw: true }),
      Order.findAll({ raw: true }),
      OrderItem.findAll({ raw: true }),
      MenuItem.findAll({ raw: true }),
      (User?.findAll ? User.findAll({ raw: true }) : []),
      (Payout?.findAll ? Payout.findAll({ raw: true }) : []),
    ]);

    const when = new Date();
    const stamp = when.toISOString().replace(/[:.]/g, "-");
    const dir = path.join(__dirname, "..", "backups");
    const outPath = path.join(dir, `backup-${stamp}.json`);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir);

    const payload = {
      meta: {
        createdAt: when.toISOString(),
        dialect: sequelize.getDialect(),
        counts: {
          vendors: vendors.length,
          orders: orders.length,
          orderItems: orderItems.length,
          menuItems: menuItems.length,
          users: users.length,
          payouts: payouts.length,
        },
      },
      data: { vendors, orders, orderItems, menuItems, users, payouts },
    };

    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log("✅ Backup saved:", outPath);
    process.exit(0);
  } catch (err) {
    console.error("❌ Backup failed:", err?.message || err);
    process.exit(1);
  }
})();