/**
 * 共享类型定义（TS 迁移新建）
 *  - DB 行类型：列与 src/db/schema.sql 对齐；dateStrings:true 下 DATETIME 返回字符串，
 *    mysql2 默认配置下 DECIMAL 返回字符串（业务代码统一 Number() 转换），故金额/坐标列放宽为 string | number。
 *  - JwtPayload / AuthedRequest：JWT 载荷与挂载 req.user 后的请求类型。
 */
import type { Request } from 'express';

/* ----------------------------- 枚举 / 字面量类型 ----------------------------- */

/** 账号角色（users.role） */
export type UserRole = 'admin' | 'customer' | 'worker';

/** 订单状态（orders.status 枚举，含阶段二的 aborted=中途结束） */
export type OrderStatus =
  | 'pending'
  | 'dispatched'
  | 'accepted'
  | 'working'
  | 'finished'
  | 'aborted'
  | 'completed'
  | 'cancelled';

/** 师傅认证状态（workers.status 枚举） */
export type WorkerStatus = 'pending' | 'approved' | 'rejected' | 'disabled';

/** 钱包流水类型（wallet_logs.type 枚举） */
export type WalletLogType = 'income' | 'withdraw' | 'refund';

/* ----------------------------- JWT / 请求 ----------------------------- */

/** JWT 载荷（util/jwt sign / verify） */
export interface JwtPayload {
  id: number;
  role: UserRole;
  name?: string;
  phone?: string;
  /** 签发时间 / 过期时间（jsonwebtoken 自动写入） */
  iat?: number;
  exp?: number;
}

/** 鉴权请求：middleware/auth.attachUser 解析 token 后挂载 req.user（null/undefined = 未登录） */
export interface AuthedRequest extends Request {
  user?: JwtPayload | null;
}

/* ----------------------------- DB 行类型 ----------------------------- */

/** users 表 */
export interface UserRow {
  id: number;
  phone: string;
  password: string;
  name: string;
  avatar: string;
  role: UserRole;
  status: number;
  openid: string;
  rating: string | number;
  restricted: number;
  restricted_reason: string;
  restricted_until: string | null;
  created_at: string;
  updated_at: string;
}

/** workers 表 */
export interface WorkerRow {
  id: number;
  user_id: number;
  real_name: string;
  id_card: string;
  region: string;
  skills: string;
  years: number;
  bio: string;
  rating: string | number;
  order_count: number;
  done_count: number;
  status: WorkerStatus;
  audit_remark: string;
  audited_at: string | null;
  restricted: number;
  restricted_reason: string;
  restricted_until: string | null;
  created_at: string;
  updated_at: string;
}

/** workers JOIN users 后的档案行（formatWorker 入参：可带 u.phone / u.name） */
export interface WorkerProfileRow extends WorkerRow {
  phone?: string;
  name?: string;
}

/** service_categories 表 */
export interface CategoryRow {
  id: number;
  name: string;
  icon: string;
  min_price: string | number;
  unit: string;
  description: string;
  sort: number;
  status: number;
  created_at: string;
}

/** orders 表 */
export interface OrderRow {
  id: number;
  order_no: string;
  customer_id: number;
  worker_id: number | null;
  category_id: number | null;
  custom_category: string;
  title: string;
  description: string | null;
  address: string;
  lng: string | number | null;
  lat: string | number | null;
  expect_at: string | null;
  budget: string | number;
  price: string | number;
  service_fee: string | number;
  status: OrderStatus;
  source: string;
  pay_status: string;
  paid_at: string | null;
  transaction_id: string;
  refund_id: string;
  refunded_at: string | null;
  refund_amount: string | number;
  refund_reason: string;
  refund_policy: string;
  billing_type: string;
  hourly_price: string | number;
  abort_reason: string;
  aborted_at: string | null;
  actual_fee: string | number;
  cancel_reason: string;
  finish_remark: string;
  rating: number | null;
  rate_comment: string;
  rate_skill: number | null;
  rate_attitude: number | null;
  rate_punctual: number | null;
  rate_tags: string;
  worker_rating: number | null;
  worker_rate_comment: string;
  worker_rate_tags: string;
  dispatch_at: string | null;
  accepted_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** ORDER_SELECT 关联查询后的订单行（JOIN users/workers/service_categories） */
export interface JoinedOrderRow extends OrderRow {
  customer_name: string;
  customer_phone: string;
  worker_name: string | null;
  worker_agg_rating: string | number | null;
  worker_phone: string | null;
  category_name: string | null;
  category_icon: string | null;
}

/** order_logs 表 */
export interface OrderLogRow {
  id: number;
  order_id: number;
  action: string;
  from_status: string;
  to_status: string;
  operator_id: number | null;
  operator_role: string;
  content: string;
  created_at: string;
}

/** order_logs LEFT JOIN users（订单详情流水带操作人昵称） */
export interface OrderLogWithOperatorRow extends OrderLogRow {
  operator_name: string | null;
}

/** wallets 表 */
export interface WalletRow {
  id: number;
  user_id: number;
  balance: string | number;
  income: string | number;
  withdrawn: string | number;
  updated_at: string;
}

/** wallet_logs 表 */
export interface WalletLogRow {
  id: number;
  user_id: number;
  order_id: number | null;
  type: WalletLogType;
  amount: string | number;
  balance_after: string | number;
  remark: string;
  created_at: string;
}

/** notifications 表 */
export interface NotificationRow {
  id: number;
  user_id: number;
  order_id: number | null;
  type: string;
  title: string;
  content: string;
  is_read: number;
  created_at: string;
}
