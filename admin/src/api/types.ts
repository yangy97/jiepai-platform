/** 与后端共享的数据类型（字段以 docs/API.md + server schema.sql 为准） */

/** 登录用户 */
export interface User {
  id: number
  phone: string
  name: string
  avatar: string
  role: 'admin' | 'customer' | 'worker'
}

/** 登录返回 */
export interface LoginResult {
  token: string
  user: User
}

/** 分页响应 */
export interface Paginated<T> {
  list: T[]
  total: number
  page: number
  page_size: number
}

/** 分页查询公共参数 */
export interface PageQuery {
  page?: number
  page_size?: number
}

/** 服务类目 */
export interface Category {
  id: number
  name: string
  icon: string
  min_price: number | string
  unit: string
  description: string
  sort: number
  /** 1 上架 0 下架 */
  status: number
}

/** 订单状态枚举（阶段二新增 aborted 中途结束） */
export type OrderStatus =
  | 'pending'
  | 'dispatched'
  | 'accepted'
  | 'working'
  | 'finished'
  | 'aborted'
  | 'completed'
  | 'cancelled'

/** 订单 */
export interface Order {
  id: number
  order_no: string
  customer_id: number
  worker_id: number | null
  worker_name?: string
  worker_phone?: string
  /** 管理端联表带出的客户展示字段 */
  customer_name?: string
  customer_phone?: string
  /** 自定义类型订单时为 null */
  category_id: number | null
  category_name?: string
  category_icon?: string
  /** 小程序/管理端「自定义」下单时的原始文本（固定类目为 ""） */
  custom_category?: string
  /** 是否自定义服务类型（后端联表返回，旧数据可能为 undefined） */
  is_custom?: boolean
  title: string
  description?: string
  address?: string
  lng?: number | null
  lat?: number | null
  expect_at?: string | null
  budget: number | string
  price: number | string
  service_fee: number | string
  status: OrderStatus
  status_text?: string
  source?: 'customer' | 'admin'
  pay_status?: 'unpaid' | 'paid' | 'refunded'
  pay_status_text?: string
  paid_at?: string | null
  transaction_id?: string
  // ---------- 阶段二：退款政策 / 计费方式（下单时锁定，不可修改） ----------
  /** flexible 支持中途退款（默认）/ strict 不可中途退款 */
  refund_policy?: 'flexible' | 'strict'
  refund_policy_text?: string
  /** fixed 一口价（默认）/ hourly 时薪 */
  billing_type?: 'fixed' | 'hourly'
  billing_type_text?: string
  /** 时薪（billing_type=hourly 时有效） */
  hourly_price?: number | string
  // ---------- 阶段二：中途结束（aborted） ----------
  /** 中途结束实收金额（aborted 待确认，completed 已入账） */
  actual_fee?: number | string
  abort_reason?: string
  aborted_at?: string | null
  // ---------- 阶段二：退款明细 ----------
  refund_amount?: number | string
  refund_reason?: string
  refund_id?: string
  refunded_at?: string | null
  // ---------- 阶段二：评价（客户 → 师傅） ----------
  rating?: number | null
  rate_comment?: string
  /** 技术 1-5 */
  rate_skill?: number | null
  /** 态度 1-5 */
  rate_attitude?: number | null
  /** 准时 1-5 */
  rate_punctual?: number | null
  /** 快捷标签，逗号分隔（≤3 个） */
  rate_tags?: string
  // ---------- 阶段二：评价（师傅 → 客户） ----------
  /** 师傅对客户的总评 1-5 */
  worker_rating?: number | null
  worker_rate_comment?: string
  /** 师傅评价标签，逗号分隔 */
  worker_rate_tags?: string
  cancel_reason?: string
  finish_remark?: string
  created_at?: string
  dispatch_at?: string | null
  accepted_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  completed_at?: string | null
}

/** 订单操作日志 */
export interface OrderLog {
  id: number
  action: string
  from_status: string
  to_status: string
  operator_name?: string
  operator_role: string
  content: string
  created_at: string
}

/** 钱包流水 */
export interface WalletLog {
  id: number
  user_id: number
  order_id: number | null
  /** 后端联表可能带出的展示字段 */
  order_no?: string
  user_name?: string
  real_name?: string
  phone?: string
  type: 'income' | 'withdraw' | 'refund'
  amount: number | string
  balance_after: number | string
  remark?: string
  created_at?: string
}

/** 订单详情（管理端） */
export interface OrderDetail {
  order: Order
  customer: User | null
  worker: Worker | null
  category: Category | null
  logs: OrderLog[]
  wallet_logs: WalletLog[]
}

/** 师傅（管理端列表/详情） */
export interface Worker {
  id: number
  user_id: number
  real_name?: string
  /** 账号昵称（后端联表可能带出） */
  name?: string
  phone?: string
  id_card?: string
  region?: string
  /** 类目 id 逗号分隔 */
  skills?: string
  /** 类目名列表（后端可能直接拼好） */
  skill_names?: string[]
  years?: number
  bio?: string
  rating?: number | string
  order_count?: number
  done_count?: number
  /** 进行中单量 */
  doing?: number
  status: 'pending' | 'approved' | 'rejected' | 'disabled'
  audit_remark?: string
  audited_at?: string | null
  // ---------- 阶段二：低分受限（1=受限中，禁止接单/被派单） ----------
  restricted?: number
  restricted_reason?: string
  restricted_until?: string | null
  created_at?: string
}

/** 师傅详情（含账号信息） */
export interface WorkerDetail {
  worker: Worker
  user: User | null
}

/** 客户（管理端列表） */
export interface Customer {
  id: number
  phone: string
  name: string
  avatar?: string
  created_at?: string
  order_count?: number
  done_count?: number
  total_spend?: number | string
  // ---------- 阶段二：低分受限（1=受限中，禁止下单） ----------
  restricted?: number
  restricted_reason?: string
  restricted_until?: string | null
}

/** 站内通知（阶段二：GET /api/notifications） */
export interface Notification {
  id: number
  /** 关联订单（部分通知可能没有） */
  order_id?: number | null
  /** 事件类型：dispatch/accept/start_remind/start_timeout/finish/confirm/refund/abort/rate/restrict 等 */
  type: string
  title: string
  content: string
  /** 0 未读 / 1 已读 */
  is_read: number
  created_at?: string
}

/** 钱包（师傅） */
export interface Wallet {
  id: number
  user_id: number
  real_name?: string
  /** 账号昵称（后端联表可能带出） */
  name?: string
  phone?: string
  balance: number | string
  income: number | string
  withdrawn: number | string
  updated_at?: string
}

/** 概览统计 */
export interface DashboardStat {
  order_count: number
  today_count: number
  pending_dispatch: number
  worker_count: number
  customer_count: number
  done_amount: number | string
  avg_rating: number | string
  doing: number
}

/** 近 N 日趋势点 */
export interface TrendPoint {
  date: string
  count: number
}

/** 状态分布点 */
export interface StatusDistItem {
  status: OrderStatus
  text: string
  count: number
}

/** 概览响应 */
export interface DashboardData {
  stat: DashboardStat
  trend: TrendPoint[]
  status_dist: StatusDistItem[]
  recent: Order[]
}
