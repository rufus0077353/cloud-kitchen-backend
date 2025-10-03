// scripts/merge-duplicate-vendors.js
const { sequelize, Vendor, MenuItem, Order, OrderItem, Payout } = require('../models');

(async () => {
  const t = await sequelize.transaction();
  try {
    const [rows] = await sequelize.query(
      `SELECT "UserId" FROM "Vendors" GROUP BY "UserId" HAVING COUNT(*) > 1`,
      { transaction: t }
    );
    for (const { UserId } of rows) {
      const vendors = await Vendor.findAll({ where: { UserId }, order: [['createdAt','DESC']], transaction: t });
      const keep = vendors[0], drop = vendors.slice(1);
      for (const v of drop) {
        await MenuItem.update({ VendorId: keep.id }, { where: { VendorId: v.id }, transaction: t });
        await Order.update   ({ VendorId: keep.id }, { where: { VendorId: v.id }, transaction: t });
        if (Payout) await Payout.update({ VendorId: keep.id }, { where: { VendorId: v.id }, transaction: t });
        await Vendor.destroy({ where: { id: v.id }, transaction: t });
      }
      console.log(`User ${UserId}: kept ${keep.id}, removed ${drop.length}`);
    }
    await t.commit();
    console.log('✅ Vendor merge complete');
    process.exit(0);
  } catch (e) {
    await t.rollback(); console.error('❌ Merge failed:', e); process.exit(1);
  }
})();