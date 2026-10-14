import type { Category, Order, OrderStatus, WalletLog } from '@/api/types'
import {
  BILLING_META,
  ORDER_STATUS_META,
  PAY_STATUS_META,
  REFUND_POLICY_META,
} from '@/constants/order.constants'
import { WORKER_STATUS_META } from '@/constants/worker.constants'
import { WALLET_TYPE_META } from '@/constants/wallet.constants'

/** 取订单状态标签文案，未知状态兜底 */
export function orderStatusLabel(status?: string) {
  return status ? (ORDER_STATUS_META[status as OrderStatus]?.label ?? status) : '—'
}

/** 取订单状态标签类型，未知状态兜底 info */
export function orderStatusTag(status?: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' {
  return status ? (ORDER_STATUS_META[status as OrderStatus]?.tag ?? 'info') : 'info'
}

/** 师傅状态文案 */
export function workerStatusLabel(status?: string) {
  return status ? (WORKER_STATUS_META[status]?.label ?? status) : '—'
}

/** 师傅状态标签类型 */
export function workerStatusTag(status?: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' {
  return status ? (WORKER_STATUS_META[status]?.tag ?? 'info') : 'info'
}

/** 流水类型文案 */
export function walletTypeLabel(type: string) {
  return WALLET_TYPE_META[type as WalletLog['type']]?.label ?? type
}

/** 流水类型标签颜色 */
export function walletTypeTag(type: string): 'success' | 'danger' | 'warning' | 'info' {
  return WALLET_TYPE_META[type as WalletLog['type']]?.tag ?? 'info'
}

/** 支付状态文案（无字段返回空串，便于 v-if 兜底） */
export function payStatusLabel(status?: string | null) {
  return status ? (PAY_STATUS_META[status]?.label ?? status) : ''
}

/** 支付状态标签颜色 */
export function payStatusTag(status?: string | null): 'success' | 'warning' | 'info' {
  return status ? (PAY_STATUS_META[status]?.tag ?? 'info') : 'info'
}

/** 退款政策完整文案（空值兜底返回空串，便于 v-if） */
export function refundPolicyLabel(policy?: string | null) {
  return policy ? (REFUND_POLICY_META[policy]?.label ?? policy) : ''
}

/** 退款政策列表紧凑文案：flexible → 可退 / strict → 不可退 */
export function refundPolicyShort(policy?: string | null) {
  return policy ? (REFUND_POLICY_META[policy]?.short ?? policy) : '—'
}

/** 退款政策标签颜色：flexible info / strict danger */
export function refundPolicyTag(policy?: string | null): 'info' | 'danger' {
  return policy ? (REFUND_POLICY_META[policy]?.tag ?? 'info') : 'info'
}

/** 计费方式短文案（空值按 schema 默认一口价兜底） */
export function billingTypeLabel(type?: string | null) {
  if (!type || type === 'fixed') return '一口价'
  return BILLING_META[type]?.label ?? type
}

/** 计费方式标签颜色 */
export function billingTypeTag(type?: string | null): 'info' | 'warning' {
  return type ? (BILLING_META[type]?.tag ?? 'info') : 'info'
}

/** 计费方式完整文案：hourly → 「时薪 ¥60/h」（需拼时薪，故为函数） */
export function billingText(type?: string | null, hourlyPrice?: number | string | null) {
  if (type === 'hourly') return `时薪 ¥${formatMoney(hourlyPrice)}/h`
  return billingTypeLabel(type)
}

/** 金额格式化（兼容后端返回 number/string） */
export function formatMoney(value?: number | string | null) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

/** 金额带符号展示（正绿负红由模板判断） */
export function signedMoney(value?: number | string | null) {
  const n = Number(value ?? 0)
  return `${n >= 0 ? '+' : '-'}¥${Math.abs(n).toFixed(2)}`
}

/** 时间格式化：空值兜底 */
export function formatTime(value?: string | null) {
  if (!value) return '—'
  // 后端返回形如 2026-10-12 09:00:00，直接展示
  return String(value).replace('T', ' ').slice(0, 19)
}

/** 手机号脱敏展示（列表用） */
export function maskPhone(phone?: string | null) {
  if (!phone) return '—'
  const p = String(phone)
  return p.length >= 11 ? `${p.slice(0, 3)}****${p.slice(7)}` : p
}

/** 类目列表转 id→类目 映射 */
export function categoryMap(list: Category[]) {
  const map = new Map<number, Category>()
  list.forEach((c) => map.set(c.id, c))
  return map
}

/** 订单类目展示文案：兼容自定义类型（is_custom 旧数据可能为 undefined，按 category_name 兜底） */
export function categoryLabel(order?: Partial<Order> | null): { text: string; custom: boolean } {
  if (!order) return { text: '—', custom: false }
  const text = order.category_name || order.custom_category || '—'
  const custom = order.is_custom === true
  return { text, custom }
}
