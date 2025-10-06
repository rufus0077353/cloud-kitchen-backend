
const { Vendor, Order, MenuItem } = require("../models");

(async () => {
  try {
    const vendors = await Vendor.findAll({
      attributes: ["UserId"],
      group: ["UserId"],
      having: Vendor.sequelize.literal("COUNT(*) > 1"),
    });

    for (const v of vendors) {
      const userId = v.UserId;
      const dups = await Vendor.findAll({ where: { UserId: userId } });
      if (dups.length < 2) continue;

      // Keep the first one, merge orders/items into it
      const keeper = dups[0];
      const extras = dups.slice(1);

      for (const ex of extras) {
        await Order.update({ VendorId: keeper.id }, { where: { VendorId: ex.id } });
        await MenuItem.update({ VendorId: keeper.id }, { where: { VendorId: ex.id } });
        await ex.destroy();
      }

      console.log(`✅ Merged ${dups.length} vendors for user ${userId} -> kept Vendor ${keeper.id}`);
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ Error cleaning vendors:", err);
    process.exit(1);
  }
})();