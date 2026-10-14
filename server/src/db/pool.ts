/**
 * 数据访问薄封装（Sequelize 迁移完成后 · docs/changes/006）
 *  - transaction：业务事务入口（回调内所有模型调用需传 { transaction: t }）
 *  - getPool：保留 mysql2 连接池，仅供 db/init.ts / db/seed.ts 等一次性脚本使用
 *    （建表 / 种子灌数是 DDL 与批量操作，不属于运行时 ORM 职责）
 * 运行时查询已全部迁移至 db/models 模型调用，本文件不再提供裸 SQL 执行器
 * （原 query / one / txQuery 已删除：service 层清零后无任何调用方）。
 */
import { createPool, type Pool } from 'mysql2/promise';
import type { Transaction } from 'sequelize';
import { sequelize } from './models';
import config from '../config/config.default';

let pool: Pool | null = null;

/** 仅供 init/seed 等脚本使用（运行时查询请走模型） */
export function getPool(): Pool {
  if (!pool) {
    pool = createPool(config.db);
  }
  return pool;
}

/** 在事务中执行：fn(t) 拿到 sequelize 事务对象（内部所有模型调用需传 { transaction: t }） */
export async function transaction<T>(fn: (t: Transaction) => Promise<T>): Promise<T> {
  return sequelize.transaction(fn);
}
