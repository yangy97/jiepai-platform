/**
 * Sequelize 桶文件：sequelize 实例 + 8 个模型（一模型一文件）
 *
 * 【连接选项与 mysql2 时代（原 db/pool.ts createPool(config.db)）逐项对齐 —— 接口返回值 parity 的根基】
 *  1. dateStrings: true      → DATETIME 读回 'YYYY-MM-DD HH:mm:ss' 字符串（原 config.db.dateStrings）
 *  2. typeCast: true         → 覆盖 sequelize 默认的自定义 typeCast（它会把 DATETIME 解析成 JS Date），
 *                              还原 mysql2 默认解析，配合 dateStrings 保证时间字段逐字节一致
 *  3. flags: ''              → 覆盖 sequelize 默认 flags:"-FOUND_ROWS"，还原 mysql2 默认连接位（含 FOUND_ROWS），
 *                              保证 UPDATE affectedRows =「匹配行数」语义与迁移前一致（CAS 判定依赖此语义）
 *  4. supportBigNumbers: true → sequelize 默认（原 pool 为 false）；本项目无 BIGINT 列、COUNT 值均在安全整数范围内，
 *                              BIGINT/DECIMAL 解析结果与原行为一致（小计数为 number、DECIMAL 为字符串）
 *  5. timezone: 本地偏移      → sequelize 默认 '+00:00'（UTC）会在写入 JS Date 时整体提前 8 小时；
 *                              设为进程本地时区偏移后，与 mysql2 默认 'local' 写入行为一致
 *
 * 【红线】绝不调用 sync/alter，模型仅做「表结构 → TS 类型 → 增删改查」映射，不改任何表。
 */
import { Sequelize, Op } from 'sequelize';
import config from '../../config/config.default';
import { User, initUserModel } from './user.model';
import { Worker, initWorkerModel } from './worker.model';
import { ServiceCategory, initServiceCategoryModel } from './service-category.model';
import { Order, initOrderModel } from './order.model';
import { OrderLog, initOrderLogModel } from './order-log.model';
import { Wallet, initWalletModel } from './wallet.model';
import { WalletLog, initWalletLogModel } from './wallet-log.model';
import { Notification, initNotificationModel } from './notification.model';

/** 进程本地时区偏移（分钟，东八区为 +480）→ '+HH:MM'，对齐 mysql2 'local' 写入语义 */
function localTimezone(): string {
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const { database, host, port, user, password, connectionLimit } = config.db;

export const sequelize = new Sequelize(database, user, password, {
  host,
  port,
  dialect: 'mysql',
  logging: false,
  timezone: localTimezone(),
  benchmark: false,
  pool: {
    max: connectionLimit,
    min: 0,
    idle: 10000,
  },
  dialectOptions: {
    dateStrings: true,
    typeCast: true,
    flags: '',
  },
});

// 实例创建后再执行各模型 init（模型文件不引用本文件，避免循环依赖）
initUserModel(sequelize);
initWorkerModel(sequelize);
initServiceCategoryModel(sequelize);
initOrderModel(sequelize);
initOrderLogModel(sequelize);
initWalletModel(sequelize);
initWalletLogModel(sequelize);
initNotificationModel(sequelize);

/* ----------------------------- 关联（仅查询用，不建约束不改表） -----------------------------
 * 注意 workers.user_id → users.id：钱包/流水按「师傅档案的 user_id」反查师傅行，
 * 故 wallets/wallet_logs → Worker 的关联 targetKey 为 workers.user_id（该列有 uk_user 唯一索引，1:1）。
 */
Wallet.belongsTo(User, { foreignKey: 'user_id', as: 'w_user' });
Wallet.belongsTo(Worker, { foreignKey: 'user_id', targetKey: 'user_id', as: 'w_worker' });
WalletLog.belongsTo(User, { foreignKey: 'user_id', as: 'l_user' });
WalletLog.belongsTo(Order, { foreignKey: 'order_id', as: 'l_order' });
OrderLog.belongsTo(User, { foreignKey: 'operator_id', as: 'operator' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'n_user' });
Notification.belongsTo(Order, { foreignKey: 'order_id', as: 'n_order' });
Order.belongsTo(User, { foreignKey: 'customer_id', as: 'tick_customer' });
Order.belongsTo(Worker, { foreignKey: 'worker_id', as: 'tick_worker' });
/* 订单四表关联（order/pay/admin 的列表·详情查询：customer=客户 users、worker=接单师傅档案、
 * category=服务类目；worker 带出 user 拿 worker_phone）。仅查询用，不建约束不改表。 */
Order.belongsTo(User, { foreignKey: 'customer_id', as: 'customer' });
Order.belongsTo(Worker, { foreignKey: 'worker_id', as: 'worker' });
Order.belongsTo(ServiceCategory, { foreignKey: 'category_id', as: 'category' });
Worker.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
/* 客户列表聚合（admin.customerList：users LEFT JOIN orders 按客户 GROUP BY 统计单量/消费） */
User.hasMany(Order, { foreignKey: 'customer_id', as: 'customer_orders' });
/* 管理端订单流水（adminDetail：wallet_logs JOIN workers 过滤出师傅钱包流水） */
WalletLog.belongsTo(Worker, { foreignKey: 'user_id', targetKey: 'user_id', as: 'l_worker' });

export { Op };
/** SQL 片段（literal/fn/col：FIELD 排序、GROUP BY 聚合等模型难以表达的取数） */
export { literal, fn, col } from 'sequelize';
export { User, Worker, ServiceCategory, Order, OrderLog, Wallet, WalletLog, Notification };
export type { UserAttributes, UserCreationAttributes } from './user.model';
export type { WorkerAttributes, WorkerCreationAttributes } from './worker.model';
export type { ServiceCategoryAttributes, ServiceCategoryCreationAttributes } from './service-category.model';
export type { OrderAttributes, OrderCreationAttributes } from './order.model';
export type { OrderLogAttributes, OrderLogCreationAttributes } from './order-log.model';
export type { WalletAttributes, WalletCreationAttributes } from './wallet.model';
export type { WalletLogAttributes, WalletLogCreationAttributes } from './wallet-log.model';
export type { NotificationAttributes, NotificationCreationAttributes } from './notification.model';
