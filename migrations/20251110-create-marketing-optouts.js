"use strict";
module.exports = {
  async up(q, S) {
    await q.createTable("marketing_optouts", {
      id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
      email: { type: S.STRING, allowNull: false, unique: true },
      reason: { type: S.STRING, allowNull: true },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
    });
  },
  async down(q) { await q.dropTable("marketing_optouts"); }
};
