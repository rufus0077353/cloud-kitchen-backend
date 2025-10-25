// migrations/202510250001_create_payout_logs.js
"use strict";
module.exports = {
  async up(q, S) {
    await q.createTable("PayoutLogs", {
      id:        { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      PayoutId:  { type: S.INTEGER, allowNull: true, references: { model: "Payouts", key: "id" }, onDelete: "CASCADE" },
      VendorId:  { type: S.INTEGER, allowNull: false, references: { model: "Vendors", key: "id" }, onDelete: "CASCADE" },
      action:    { type: S.ENUM("scheduled","paid","note"), allowNull: false },
      adminUser: { type: S.STRING, allowNull: false },
      note:      { type: S.TEXT, allowNull: true },
      createdAt: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
      updatedAt: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
    });
  },
  async down(q) { await q.dropTable("PayoutLogs"); }
};