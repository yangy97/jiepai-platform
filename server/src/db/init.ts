/**
 * 初始化数据库：建库 + 执行 schema.sql 建表
 * 用法：
 *   npx tsx src/db/init.ts            # 幂等建表（已存在则跳过）
 *   npx tsx src/db/init.ts --reset    # 删库重建（危险操作）
 */
import fs from 'fs';
import path from 'path';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import config from '../config/config.default';

async function main() {
  const reset = process.argv.includes('--reset');
  const { database, ...base } = config.db;

  const conn = await createConnection(base);

  if (reset) {
    await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
    console.log(`[init] 已删除数据库 ${database}`);
  }
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
  );
  console.log(`[init] 数据库 ${database} 就绪`);
  await conn.changeUser({ database });

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // 去掉注释后按分号拆分执行（schema 不含存储过程/触发器，安全）
  const statements = schema
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sql of statements) {
    await conn.query(sql);
  }
  console.log(`[init] 已执行 ${statements.length} 条建表语句`);

  // ---------- 存量库结构升级（幂等） ----------
  const cols = await conn.query<RowDataPacket[]>(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders'
  `, [database]);
  const names = cols[0].map((c) => c.COLUMN_NAME as string);

  if (!names.includes('custom_category')) {
    await conn.query(`ALTER TABLE orders ADD COLUMN custom_category VARCHAR(100) NOT NULL DEFAULT '' COMMENT '自定义服务类型' AFTER category_id`);
    console.log('[init] orders 增加 custom_category');
  }
  const catCol = (await conn.query<RowDataPacket[]>(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'category_id'`,
    [database],
  ))[0][0];
  if (catCol && catCol.IS_NULLABLE === 'NO') {
    await conn.query('ALTER TABLE orders MODIFY category_id INT UNSIGNED NULL COMMENT \'服务类目；自定义类型订单为 NULL\'');
    console.log('[init] orders.category_id 改为可空（支持自定义类型）');
  }

  // ---------- 支付字段（幂等）：orders 支付列 + users.openid ----------
  const orderCols = cols[0].map((c) => c.COLUMN_NAME as string);
  const orderPayCols: Array<[string, string]> = [
    ['pay_status', `ALTER TABLE orders ADD COLUMN pay_status VARCHAR(16) NOT NULL DEFAULT 'unpaid' COMMENT '支付状态 unpaid/paid/refunded' AFTER source`],
    ['paid_at', `ALTER TABLE orders ADD COLUMN paid_at DATETIME NULL COMMENT '支付成功时间' AFTER pay_status`],
    ['transaction_id', `ALTER TABLE orders ADD COLUMN transaction_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '微信支付单号（mock 时为 MOCK+时间戳）' AFTER paid_at`],
    ['refund_id', `ALTER TABLE orders ADD COLUMN refund_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '微信退款单号' AFTER transaction_id`],
    ['refunded_at', `ALTER TABLE orders ADD COLUMN refunded_at DATETIME NULL COMMENT '退款时间' AFTER refund_id`],
  ];
  let payColAdded = false;
  for (const [name, ddl] of orderPayCols) {
    if (orderCols.includes(name)) continue;
    await conn.query(ddl);
    if (name === 'pay_status') payColAdded = true;
    console.log(`[init] orders 增加 ${name}`);
  }
  // 存量订单都是升级前的种子/演示订单：视为线下已付（paid_at 取下单时间）
  if (payColAdded) {
    await conn.query(`UPDATE orders SET pay_status = 'paid', paid_at = created_at WHERE pay_status = 'unpaid'`);
    console.log('[init] 存量种子订单已标记为「已支付」');
  }

  const userCols = (await conn.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
    [database],
  ))[0].map((c) => c.COLUMN_NAME as string);
  if (!userCols.includes('openid')) {
    await conn.query(`ALTER TABLE users ADD COLUMN openid VARCHAR(64) NOT NULL DEFAULT '' COMMENT '微信小程序 openid（JSAPI 下单用，code2session 后缓存）' AFTER status`);
    console.log('[init] users 增加 openid');
  }

  // ---------- 阶段二（docs/DESIGN-phase2.md §1）：中途退出 / 退款政策 / 评价惩罚 / 通知表 ----------
  const curOrderCols = ((await conn.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders'`,
    [database],
  ))[0] || []).map((c) => c.COLUMN_NAME as string);

  const phase2OrderCols: Array<[string, string]> = [
    ['refund_policy', `ALTER TABLE orders ADD COLUMN refund_policy VARCHAR(16) NOT NULL DEFAULT 'flexible' COMMENT 'flexible 支持中途退款 / strict 不可中途退款' AFTER refunded_at`],
    ['billing_type', `ALTER TABLE orders ADD COLUMN billing_type VARCHAR(16) NOT NULL DEFAULT 'fixed' COMMENT 'fixed 一口价 / hourly 时薪' AFTER refund_policy`],
    ['hourly_price', `ALTER TABLE orders ADD COLUMN hourly_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '时薪（billing_type=hourly）' AFTER billing_type`],
    ['abort_reason', `ALTER TABLE orders ADD COLUMN abort_reason VARCHAR(255) NOT NULL DEFAULT '' COMMENT '中途结束原因' AFTER hourly_price`],
    ['aborted_at', `ALTER TABLE orders ADD COLUMN aborted_at DATETIME NULL COMMENT '中途结束时间' AFTER abort_reason`],
    ['actual_fee', `ALTER TABLE orders ADD COLUMN actual_fee DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '中途结算实收金额' AFTER aborted_at`],
    ['refund_amount', `ALTER TABLE orders ADD COLUMN refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '实际退款金额' AFTER actual_fee`],
    ['refund_reason', `ALTER TABLE orders ADD COLUMN refund_reason VARCHAR(255) NOT NULL DEFAULT '' COMMENT '退款原因' AFTER refund_amount`],
    ['rate_skill', `ALTER TABLE orders ADD COLUMN rate_skill TINYINT NULL COMMENT '技术 1-5' AFTER rate_comment`],
    ['rate_attitude', `ALTER TABLE orders ADD COLUMN rate_attitude TINYINT NULL COMMENT '态度 1-5' AFTER rate_skill`],
    ['rate_punctual', `ALTER TABLE orders ADD COLUMN rate_punctual TINYINT NULL COMMENT '准时 1-5' AFTER rate_attitude`],
    ['rate_tags', `ALTER TABLE orders ADD COLUMN rate_tags VARCHAR(200) NOT NULL DEFAULT '' COMMENT '快捷标签，逗号分隔' AFTER rate_punctual`],
    ['worker_rating', `ALTER TABLE orders ADD COLUMN worker_rating TINYINT NULL COMMENT '客户配合度 1-5（师傅→客户评价）' AFTER rate_tags`],
    ['worker_rate_comment', `ALTER TABLE orders ADD COLUMN worker_rate_comment VARCHAR(255) NOT NULL DEFAULT '' COMMENT '师傅对客户的评价' AFTER worker_rating`],
    ['worker_rate_tags', `ALTER TABLE orders ADD COLUMN worker_rate_tags VARCHAR(200) NOT NULL DEFAULT '' COMMENT '师傅给客户的标签，逗号分隔' AFTER worker_rate_comment`],
  ];
  for (const [name, ddl] of phase2OrderCols) {
    if (curOrderCols.includes(name)) continue;
    await conn.query(ddl);
    console.log(`[init] orders 增加 ${name}`);
  }

  // 状态枚举补 aborted（中途结束）
  const statusCol = (await conn.query<RowDataPacket[]>(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'status'`,
    [database],
  ))[0][0];
  if (statusCol && !String(statusCol.COLUMN_TYPE).includes('aborted')) {
    await conn.query(
      `ALTER TABLE orders MODIFY status ENUM('pending','dispatched','accepted','working','finished','aborted','completed','cancelled') NOT NULL DEFAULT 'pending' COMMENT '订单状态（aborted=中途结束）'`,
    );
    console.log('[init] orders.status 枚举增加 aborted');
  }

  const phase2UserCols: Array<[string, string]> = [
    ['rating', `ALTER TABLE users ADD COLUMN rating DECIMAL(2,1) NOT NULL DEFAULT 5.0 COMMENT '客户被评均分（师傅→客户）' AFTER openid`],
    ['restricted', `ALTER TABLE users ADD COLUMN restricted TINYINT NOT NULL DEFAULT 0 COMMENT '1 受限（近 N 单均分过低，禁止下单）' AFTER rating`],
    ['restricted_reason', `ALTER TABLE users ADD COLUMN restricted_reason VARCHAR(255) NOT NULL DEFAULT '' COMMENT '受限原因' AFTER restricted`],
    ['restricted_until', `ALTER TABLE users ADD COLUMN restricted_until DATETIME NULL COMMENT '受限解除时间' AFTER restricted_reason`],
  ];
  for (const [name, ddl] of phase2UserCols) {
    if (userCols.includes(name)) continue;
    await conn.query(ddl);
    console.log(`[init] users 增加 ${name}`);
  }

  const workerCols = (await conn.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'workers'`,
    [database],
  ))[0].map((c) => c.COLUMN_NAME as string);
  const phase2WorkerCols: Array<[string, string]> = [
    ['restricted', `ALTER TABLE workers ADD COLUMN restricted TINYINT NOT NULL DEFAULT 0 COMMENT '1 受限（近 N 单均分过低，禁止接单/派单）' AFTER audited_at`],
    ['restricted_reason', `ALTER TABLE workers ADD COLUMN restricted_reason VARCHAR(255) NOT NULL DEFAULT '' COMMENT '受限原因' AFTER restricted`],
    ['restricted_until', `ALTER TABLE workers ADD COLUMN restricted_until DATETIME NULL COMMENT '受限解除时间' AFTER restricted_reason`],
  ];
  for (const [name, ddl] of phase2WorkerCols) {
    if (workerCols.includes(name)) continue;
    await conn.query(ddl);
    console.log(`[init] workers 增加 ${name}`);
  }

  // 站内通知表（CREATE TABLE IF NOT EXISTS，schema.sql 已含；此处兜底存量库）
  await conn.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      order_id INT UNSIGNED NULL,
      type VARCHAR(32) NOT NULL COMMENT 'dispatch/accept/start_remind/start_timeout/finish/confirm/refund/rate/restrict/abort',
      title VARCHAR(100) NOT NULL,
      content VARCHAR(255) NOT NULL,
      is_read TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user (user_id, is_read, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('[init] notifications 表就绪');

  const [tables] = await conn.query<RowDataPacket[]>('SHOW TABLES');
  console.log('[init] 当前表：', tables.map((row) => Object.values(row)[0]).join(', '));
  await conn.end();
}

main().catch((err) => {
  console.error('[init] 失败：', (err as Error).message);
  process.exit(1);
});
