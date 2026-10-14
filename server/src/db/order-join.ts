/**
 * 订单四表关联取数（Sequelize 二阶段迁移 · 共享于 order/pay/admin service）
 *
 * 与原 `constant/order.constant.ts` 的 ORDER_SELECT 语义逐项对齐：
 *  - JOIN users c        → include customer（required: true = INNER JOIN）
 *  - LEFT JOIN workers w → include worker（required: false）
 *  - LEFT JOIN users u2  → worker 内嵌 include user（required: false）
 *  - LEFT JOIN sc        → include category（required: false）
 *
 * 输出：模型行（raw + nest）经 flattenOrder 展平成原 ORDER_SELECT 扁平行契约 JoinedOrderRow，
 * formatOrder 的输入契约与输出字节不变。
 * 注意：include 必须 raw:true + nest:true（raw 单独用会把嵌套字段扁平成 'customer.name' 键）。
 */
import type { WhereOptions } from 'sequelize';
import { Order, User, Worker, ServiceCategory, Op } from './models';
import type { JoinedOrderRow } from '../types';

export { Op };

/** 订单 include（customer 必有=INNER；worker/category 可空=LEFT） */
export function orderInclude() {
  return [
    { model: User, as: 'customer', attributes: ['name', 'phone'], required: true },
    {
      model: Worker,
      as: 'worker',
      attributes: ['real_name', 'rating'],
      required: false,
      include: [{ model: User, as: 'user', attributes: ['phone'], required: false }],
    },
    { model: ServiceCategory, as: 'category', attributes: ['name', 'icon'], required: false },
  ];
}

/** 模型行（raw+nest）→ 原 ORDER_SELECT 扁平行（列名/可空性与 SQL 别名一致） */
export function flattenOrder(row: any): JoinedOrderRow {
  const { customer, worker, category, ...order } = row;
  return {
    ...order,
    customer_name: customer?.name ?? null,
    customer_phone: customer?.phone ?? null,
    worker_name: worker?.real_name ?? null,
    worker_agg_rating: worker?.rating ?? null,
    worker_phone: worker?.user?.phone ?? null,
    category_name: category?.name ?? null,
    category_icon: category?.icon ?? null,
  } as unknown as JoinedOrderRow;
}

/** 单行取数（= 原 `ORDER_SELECT WHERE ...`）；找不到返回 null */
export async function findJoinedOrder(where: WhereOptions, extra: Record<string, any> = {}): Promise<JoinedOrderRow | null> {
  const row = await Order.findOne({ where, include: orderInclude(), raw: true, nest: true, ...extra });
  return row ? flattenOrder(row) : null;
}

/** 列表取数（= 原 `ORDER_SELECT WHERE ... ORDER BY ... LIMIT ...`） */
export async function listJoinedOrders(options: Record<string, any>): Promise<JoinedOrderRow[]> {
  const rows = await Order.findAll({
    include: orderInclude(),
    raw: true,
    nest: true,
    ...options,
  });
  return (rows as unknown as any[]).map(flattenOrder);
}
