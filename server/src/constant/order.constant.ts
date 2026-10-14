/**
 * 订单领域常量与 SQL 片段
 */
import type { OrderStatus } from '../types';

export const STATUS_TEXT: Record<OrderStatus, string> = {
  pending: '待接单',
  dispatched: '已派单',
  accepted: '已接单',
  working: '服务中',
  finished: '待确认',
  aborted: '中途结束', // 阶段二：working → aborted → completed（按进度结算）
  completed: '已完成',
  cancelled: '已取消',
};

/** 支付状态 → 中文（order.pay_status） */
export const PAY_STATUS_TEXT: Record<string, string> = {
  unpaid: '待支付',
  paid: '已支付',
  refunded: '已退款',
};

/** 退款政策 → 中文（order.refund_policy，下单锁定） */
export const REFUND_POLICY_TEXT: Record<string, string> = {
  flexible: '支持中途退款',
  strict: '不支持中途退款',
};

/** 计费方式 → 中文（order.billing_type，下单锁定） */
export const BILLING_TYPE_TEXT: Record<string, string> = {
  fixed: '一口价',
  hourly: '时薪',
};

export const ORDER_SELECT = `
  SELECT o.*,
         c.name AS customer_name, c.phone AS customer_phone,
         w.real_name AS worker_name, w.rating AS worker_agg_rating,
         u2.phone AS worker_phone,
         sc.name AS category_name, sc.icon AS category_icon
  FROM orders o
  JOIN users c ON c.id = o.customer_id
  LEFT JOIN workers w ON w.id = o.worker_id
  LEFT JOIN users u2 ON u2.id = w.user_id
  LEFT JOIN service_categories sc ON sc.id = o.category_id
`;
