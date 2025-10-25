// migrations/202510250002_add_utr_to_payouts.js
"use strict";
module.exports = {
  async up(q, S) {
    await q.addColumn("Payouts", "utrNumber", { type: S.STRING, allowNull: true });
    await q.addColumn("Payouts", "paidOn",    { type: S.DATE,   allowNull: true });
  },
  async down(q) {
    await q.removeColumn("Payouts", "utrNumber");
    await q.removeColumn("Payouts", "paidOn");
  },
};