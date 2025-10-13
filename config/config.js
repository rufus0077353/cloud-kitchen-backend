require("dotenv").config();

const base = {
  dialect: "postgres",
  dialectModule: require("pg"),
  logging: false,
};

module.exports = {
  development: {
    ...base,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: "postgres",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      }
    },
    logging: false,
  },

  test: {
    ...base,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialectOptions: {},
  },

  production: {
    ...base,
    use_env_variable: "DATABASE_URL",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  },
};