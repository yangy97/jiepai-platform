import type { OrderStatus } from '@/api/types'

/** 订单状态 → 文案/标签颜色（全局统一复用） */
export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tag: 'primary' | 'success' | 'warning' | 'info' | 'danger' }> = {
  pending: { label: '待接单', tag: 'warning' },
  dispatched: { label: '已派单', tag: 'primary' },
  accepted: { label: '已接单', tag: 'success' },
  working: { label: '服务中', tag: 'primary' },
  finished: { label: '待确认', tag: 'warning' },
  // 阶段二新增：中途结束（服务已开始但提前终止，待确认实收）—— 用 danger 区分于常规流转
  aborted: { label: '中途结束', tag: 'danger' },
  completed: { label: '已完成', tag: 'success' },
  cancelled: { label: '已取消', tag: 'info' },
}

/** 订单状态可选项（下拉筛选用） */
export const ORDER_STATUS_OPTIONS = Object.entries(ORDER_STATUS_META).map(
  ([value, meta]) => ({ value, label: meta.label }),
)

/** 支付状态 → 文案/颜色（未支付/已支付/已退款） */
export const PAY_STATUS_META: Record<string, { label: string; tag: 'success' | 'warning' | 'info' }> = {
  unpaid: { label: '待支付', tag: 'warning' },
  paid: { label: '已支付', tag: 'success' },
  refunded: { label: '已退款', tag: 'info' },
}

/** 退款政策 → 文案/颜色（下单时锁定，flexible 支持中途退款 / strict 不可中途退款） */
export const REFUND_POLICY_META: Record<string, { label: string; short: string; tag: 'info' | 'danger' }> = {
  flexible: { label: '支持中途退款', short: '可退', tag: 'info' },
  strict: { label: '不支持中途退款', short: '不可退', tag: 'danger' },
}

/** 计费方式 → 文案/颜色（fixed 一口价 / hourly 时薪） */
export const BILLING_META: Record<string, { label: string; tag: 'info' | 'warning' }> = {
  fixed: { label: '一口价', tag: 'info' },
  hourly: { label: '时薪', tag: 'warning' },
}
