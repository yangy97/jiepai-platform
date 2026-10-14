#!/usr/bin/env node
/**
 * 测试辅助：直接向 MySQL 执行一条 SQL 并输出 JSON 结果
 * 背景：服务端迁移 TS 后，测试脚本里的 node -e require('./src/db/pool') 不再可用，
 *       本工具用 mysql2 直连（与服务端同一 .env 配置），迁移前后均可运行。
 * 用法：node scripts/run-sql.mjs "UPDATE orders SET ... WHERE id = 1"
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../package.json'));
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const sql = process.argv[2];
if (!sql) {
  console.error('用法: node scripts/run-sql.mjs "<SQL>"');
  process.exit(2);
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'jiepai_platform',
  dateStrings: true,
});
try {
  const [r] = await conn.query(sql);
  console.log(JSON.stringify(r));
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  await conn.end();
}
