
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add new columns if missing
    const table = "Payouts";
    const describe = await queryInterface.describeTable(table);

    if (!describe.grossAmount) {
      await queryInterface.addColumn(table, "grossAmount", { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 });
    }
    if (!describe.commissionAmount) {
      await queryInterface.addColumn(table, "commissionAmount", { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 });
    }
    if (!describe.payoutAmount) {
      await queryInterface.addColumn(table, "payoutAmount", { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 });
    }
    if (!describe.scheduledAt) {
      await queryInterface.addColumn(table, "scheduledAt", { type: Sequelize.DATE, allowNull: true });
    }
    if (!describe.paidAt) {
      await queryInterface.addColumn(table, "paidAt", { type: Sequelize.DATE, allowNull: true });
    }

    // Replace legacy enum with the new one (pending, scheduled, paid)
    if (describe.status && describe.status.type.toLowerCase().includes("enum")) {
      // Postgres-safe: create a new type, alter, drop old type
      try {
        await queryInterface.sequelize.transaction(async (t) => {
          await queryInterface.sequelize.query(`DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_"Payouts"_status_new') THEN
              CREATE TYPE "enum_"Payouts"_status_new" AS ENUM ('pending','scheduled','paid');
            END IF;
          END$$;`, { transaction: t });

          await queryInterface.changeColumn(table, "status", {
            type: Sequelize.ENUM("pending", "scheduled", "paid"),
            allowNull: false,
            defaultValue: "pending",
          }, { transaction: t });
        });
      } catch (e) {
        // If DB isn’t Postgres or enum already OK, ignore
      }
    }

    // Drop legacy columns if they exist
    if (describe.amount) {
      await queryInterface.removeColumn(table, "amount").catch(() => {});
    }
    if (describe.paymentStatus) {
      await queryInterface.removeColumn(table, "paymentStatus").catch(() => {});
    }
  },

  async down(queryInterface, Sequelize) {
    const table = "Payouts";
    // Best-effort revert (keep data-safe)
    await queryInterface.addColumn(table, "amount", { type: Sequelize.FLOAT, allowNull: true }).catch(()=>{});
    await queryInterface.addColumn(table, "paymentStatus", { type: Sequelize.STRING, allowNull: true }).catch(()=>{});
    // We won’t drop the new columns on down, to avoid data loss.
  },
};