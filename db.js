const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

let _sql;
const sql = (strings, ...values) => {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql(strings, ...values);
};

module.exports = sql;
