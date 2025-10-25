// migrations/20251025-extend-vendors-for-marketplace-ui.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // ------- helpers -------
    async function safeAddColumn(table, column, definition) {
      const desc = await queryInterface.describeTable(table);
      if (!desc[column]) {
        await queryInterface.addColumn(table, column, definition);
      } else {
        console.log(`⚠️  Skipping: column ${column} already exists on ${table}`);
      }
    }
    async function safeAddIndex(table, fields, name) {
      try {
        await queryInterface.addIndex(table, { fields, name, concurrently: true });
      } catch (e) {
        console.log(`⚠️  Skipping index ${name}: ${e.message}`);
      }
    }

    // ------- columns -------
    await safeAddColumn('Vendors', 'isOpen', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await safeAddColumn('Vendors', 'imageUrl', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn('Vendors', 'description', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await safeAddColumn('Vendors', 'ratingAvg', {
      type: Sequelize.DOUBLE,
      allowNull: false,
      defaultValue: 0,
    });
    await safeAddColumn('Vendors', 'ratingCount', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await safeAddColumn('Vendors', 'etaMins', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 30,
    });
    await safeAddColumn('Vendors', 'deliveryFee', {
      type: Sequelize.DOUBLE,
      allowNull: false,
      defaultValue: 0,
    });

    // ------- indexes (best-effort) -------
    await safeAddIndex('Vendors', ['isOpen'],  'vendors_isopen_idx');
    await safeAddIndex('Vendors', ['name'],    'vendors_name_idx');
    await safeAddIndex('Vendors', ['cuisine'], 'vendors_cuisine_idx');
  },

  down: async (queryInterface /*, Sequelize */) => {
    // best-effort removals; ignore errors if not present
    async function safeRemoveColumn(table, column) {
      try { await queryInterface.removeColumn(table, column); }
      catch (e) { console.log(`⚠️  Skip remove ${column}: ${e.message}`); }
    }
    async function safeRemoveIndex(table, name) {
      try { await queryInterface.removeIndex(table, name); }
      catch (e) { console.log(`⚠️  Skip remove index ${name}: ${e.message}`); }
    }

    await safeRemoveIndex('Vendors', 'vendors_isopen_idx');
    await safeRemoveIndex('Vendors', 'vendors_name_idx');
    await safeRemoveIndex('Vendors', 'vendors_cuisine_idx');

    await safeRemoveColumn('Vendors', 'deliveryFee');
    await safeRemoveColumn('Vendors', 'etaMins');
    await safeRemoveColumn('Vendors', 'ratingCount');
    await safeRemoveColumn('Vendors', 'ratingAvg');
    await safeRemoveColumn('Vendors', 'description');
    await safeRemoveColumn('Vendors', 'imageUrl');
    await safeRemoveColumn('Vendors', 'isOpen');
  },
};