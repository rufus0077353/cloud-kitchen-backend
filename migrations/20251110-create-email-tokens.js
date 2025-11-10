"use strict";
module.exports = {
  async up(q, S) {
    await q.createTable("email_tokens", {
      id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: S.INTEGER, allowNull: false },
      token_hash: { type: S.STRING, allowNull: false },
      expires_at: { type: S.DATE, allowNull: false },
      consumed_at: { type: S.DATE, allowNull: true },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
    });
    await q.addIndex("email_tokens", ["user_id"]);
  },
  async down(q) { await q.dropTable("email_tokens"); }
};
