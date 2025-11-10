
"use strict";
module.exports = {
  async up(q, S) {
    await q.createTable("otp_codes", {
      id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: S.INTEGER, allowNull: true },     // optional if user exists
      email: { type: S.STRING, allowNull: false },
      purpose: { type: S.STRING, allowNull: false },     // login | signup | reset
      code_hash: { type: S.STRING, allowNull: false },   // store hash, not raw
      expires_at: { type: S.DATE, allowNull: false },
      consumed_at: { type: S.DATE, allowNull: true },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
    });
    await q.addIndex("otp_codes", ["email", "purpose"]);
  },
  async down(q) { await q.dropTable("otp_codes"); }
};