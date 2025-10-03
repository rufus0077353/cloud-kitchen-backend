// migrations/XXXXXXXXXX-make-UserId-unique-on-Vendor.js
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Vendors','UserId',{
      type: Sequelize.INTEGER,
      allowNull:false,
    });
    await queryInterface.addIndex('Vendors',['UserId'],{
      unique:true,
      name:'vendors_userid_unique',
    });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('Vendors','vendors_userid_unique');
  }
};