import { get, post } from '../http'
import type { Order, OrderDetail, PageQuery, Paginated } from '../types'

/** 订单列表查询参数 */
export interface OrderQuery extends PageQuery {
  status?: string
  keyword?: string
}

/** 代客下单入参 */
export interface CreateOrderPayload {
  customer_id: number
  category_id: number
  title: string
  description?: string
  address: string
  /** 地图选点坐标（选填） */
  lng?: number
  lat?: number
  expect_at?: string
  budget: number
  /** 退款政策（下单锁定）：flexible 支持中途退款（默认）/ strict 不可中途退款 */
  refund_policy?: 'flexible' | 'strict'
  /** 计费方式：fixed 一口价（默认）/ hourly 时薪 */
  billing_type?: 'fixed' | 'hourly'
  /** 时薪（billing_type=hourly 时必填，>0） */
  hourly_price?: number
}

/** 手动退款入参（缺省 amount = 全额） */
export interface RefundPayload {
  /** 退款金额（≤ 支付金额） */
  amount?: number
  /** 退款原因（留审计日志） */
  reason?: string
}

/** 中途结束入参：POST /api/orders/:id/abort（非 /api/admin 前缀，admin token 同样可用） */
export interface AbortPayload {
  /** 结束原因（必填） */
  reason: string
  /** 实收金额（fixed 单必填；hourly 单服务端按时长公式自动算，忽略该值） */
  price?: number
}

/** 运营代操作入参 */
export interface OrderHandlingPayload {
  action: 'start' | 'finish' | 'confirm' | 'cancel'
  price?: number
  reason?: string
  remark?: string
}

/** 订单分页列表 */
export function fetchOrders(params: OrderQuery) {
  return get<Paginated<Order>>('/api/admin/orders', { params })
}

/** 订单详情（含客户/师傅/类目/日志/流水） */
export function fetchOrderDetail(id: number) {
  return get<OrderDetail>(`/api/admin/orders/${id}`)
}

/** 代客下单 */
export function createOrder(payload: CreateOrderPayload) {
  return post<{ order: Order }>('/api/admin/orders', payload)
}

/** 派单 / 改派 */
export function dispatchOrder(id: number, workerId: number) {
  return post<{ order: Order }>(`/api/admin/orders/${id}/dispatch`, { worker_id: workerId })
}

/** 代操作状态流转（开始服务/完成/确认/取消） */
export function handleOrder(id: number, payload: OrderHandlingPayload) {
  return post<{ order: Order }>(`/api/admin/orders/${id}/handling`, payload)
}

/** 整单/部分退款（仅已支付未结算的订单；带金额与原因，留审计日志；mock 直接落库，真实模式调微信退款 API） */
export function refundOrder(id: number, payload?: RefundPayload) {
  return post<{ order: Order }>(`/api/admin/orders/${id}/refund`, payload ?? {})
}

/** 中途结束（working → aborted，按所填实收/时长公式结算，待客户确认） */
export function abortOrder(id: number, payload: AbortPayload) {
  return post<{ order: Order }>(`/api/orders/${id}/abort`, payload)
}
