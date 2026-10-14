/**
 * 数据行 → 接口返回结构的格式化工具
 */
import type { JoinedOrderRow, OrderStatus } from '../types';
import { STATUS_TEXT, PAY_STATUS_TEXT, REFUND_POLICY_TEXT, BILLING_TYPE_TEXT } from '../constant/order.constant';

/** 数据库行 → 接口返回的 Order 结构 */
export interface FormattedOrder {
  id: number;
  order_no: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  worker_id: number | null;
  worker_name: string;
  worker_phone: string;
  /** 订单级双向评价：师傅给客户的评分（师傅个人均分见 worker_agg_rating / worker 详情） */
  worker_rating: number | null;
  worker_rate_comment: string;
  worker_rate_tags: string;
  category_id: number | null;
  category_name: string;
  category_icon: string;
  custom_category: string;
  is_custom: boolean;
  title: string;
  description: string;
  address: string;
  lng: string | number | null;
  lat: string | number | null;
  expect_at: string | null;
  budget: number;
  price: number;
  service_fee: number;
  status: OrderStatus;
  status_text: string;
  source: string;
  pay_status: string;
  pay_status_text: string;
  paid_at: string | null;
  transaction_id: string;
  // —— 阶段二：退款政策 / 计费方式（下单锁定）与退款明细 ——
  refund_policy: string;
  refund_policy_text: string;
  billing_type: string;
  billing_type_text: string;
  hourly_price: number;
  actual_fee: number;
  abort_reason: string;
  aborted_at: string | null;
  refund_amount: number;
  refund_reason: string;
  refund_id: string;
  refunded_at: string | null;
  cancel_reason: string;
  finish_remark: string;
  rating: number | null;
  rate_comment: string;
  rate_skill: number | null;
  rate_attitude: number | null;
  rate_punctual: number | null;
  rate_tags: string;
  dispatch_at: string | null;
  accepted_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export function formatOrder(row: JoinedOrderRow): FormattedOrder;
export function formatOrder(row: JoinedOrderRow | null): FormattedOrder | null;
export function formatOrder(row: JoinedOrderRow | null): FormattedOrder | null {
  if (!row) return null;
  const isCustom = !row.category_id;
  const categoryName = isCustom ? (row.custom_category || row.title) : row.category_name;
  const refundPolicy = row.refund_policy || 'flexible';
  const billingType = row.billing_type || 'fixed';
  return {
    id: row.id,
    order_no: row.order_no,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    worker_id: row.worker_id,
    worker_name: row.worker_name || '',
    worker_phone: row.worker_phone || '',
    // 订单级双向评价：师傅给客户的评分（师傅个人均分见 worker_agg_rating / worker 详情）
    worker_rating: row.worker_rating ?? null,
    worker_rate_comment: row.worker_rate_comment || '',
    worker_rate_tags: row.worker_rate_tags || '',
    category_id: row.category_id ?? null,
    category_name: categoryName || '其他服务',
    category_icon: isCustom ? '📋' : (row.category_icon || '🔧'),
    custom_category: row.custom_category || '',
    is_custom: isCustom,
    title: row.title,
    description: row.description || '',
    address: row.address,
    lng: row.lng,
    lat: row.lat,
    expect_at: row.expect_at,
    budget: Number(row.budget),
    price: Number(row.price),
    service_fee: Number(row.service_fee),
    status: row.status,
    status_text: STATUS_TEXT[row.status] || row.status,
    source: row.source,
    pay_status: row.pay_status || 'unpaid',
    pay_status_text: PAY_STATUS_TEXT[row.pay_status || 'unpaid'] || row.pay_status || 'unpaid',
    paid_at: row.paid_at || null,
    transaction_id: row.transaction_id || '',
    // —— 阶段二：退款政策 / 计费方式（下单锁定）与退款明细 ——
    refund_policy: refundPolicy,
    refund_policy_text: REFUND_POLICY_TEXT[refundPolicy] || refundPolicy,
    billing_type: billingType,
    billing_type_text: BILLING_TYPE_TEXT[billingType] || billingType,
    hourly_price: Number(row.hourly_price || 0),
    actual_fee: Number(row.actual_fee || 0),
    abort_reason: row.abort_reason || '',
    aborted_at: row.aborted_at || null,
    refund_amount: Number(row.refund_amount || 0),
    refund_reason: row.refund_reason || '',
    refund_id: row.refund_id || '',
    refunded_at: row.refunded_at || null,
    cancel_reason: row.cancel_reason || '',
    finish_remark: row.finish_remark || '',
    rating: row.rating,
    rate_comment: row.rate_comment || '',
    rate_skill: row.rate_skill ?? null,
    rate_attitude: row.rate_attitude ?? null,
    rate_punctual: row.rate_punctual ?? null,
    rate_tags: row.rate_tags || '',
    dispatch_at: row.dispatch_at,
    accepted_at: row.accepted_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
