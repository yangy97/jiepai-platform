/**
 * 订单服务（核心）：下单 / 大厅抢单 / 我的订单 / 状态流转 / 派单 / 中途结束 / 评价 / 管理端查询
 * 状态机：pending → dispatched → accepted → working → finished → completed
 *          任意非终态 → cancelled；新增分支 working → aborted（中途结束）→ completed
 * 退款决策表见 docs/DESIGN-phase2.md §2.1（cancel 内强制执行）
 *
 * Sequelize 二阶段迁移：四表 JOIN 取数走 db/order-join（模型 include + raw/nest + flattenOrder，
 * formatOrder 输入契约 JoinedOrderRow 不变）；列表/搜索为 conditions 累加 + findAndCountAll；
 * CAS 状态流转为 Order.update({ where: { id, status: { [Op.in]: fromList } } }) 检查 affectedCount。
 */

import type { WhereOptions } from 'sequelize';
import { transaction } from '../../db/pool';
import { Order, OrderLog, ServiceCategory, User, Wallet, WalletLog, Worker, Op, literal } from '../../db/models';
import { findJoinedOrder, listJoinedOrders, orderInclude, flattenOrder } from '../../db/order-join';
import config from '../../config/config.default';
import { genOrderNo } from '../../util/orderNo';
import { badRequest, forbidden, notFound, conflict } from '../../util/response';
import { STATUS_TEXT } from '../../constant/order.constant';
import { formatOrder, type FormattedOrder } from '../../util/format';
import { NOTIFICATION_TYPE } from '../../constant/notification.constant';
import * as payService from './pay.service';
import * as notificationService from './notification.service';
import * as restrictService from './restrict.service';
import type {
  JoinedOrderRow,
  JwtPayload,
  OrderStatus,
  WorkerRow,
} from '../../types';

/* ----------------------------- 小工具 ----------------------------- */

/** 分页参数（req.query 直传，字段可能是字符串） */
export interface PageParams {
  [key: string]: any;
}

export function paging({ page, page_size }: PageParams) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(50, Math.max(1, Number(page_size) || 10));
  return { p, size, offset: (p - 1) * size };
}

async function getWorkerId(userId: number): Promise<WorkerRow | null> {
  const w = await Worker.findOne({ where: { user_id: userId }, raw: true });
  return (w as unknown as WorkerRow) || null;
}

/** workers.id → 关联 users.id（发通知用） */
async function workerUserId(workerId: number): Promise<number | null> {
  const w = await Worker.findByPk(workerId, { attributes: ['user_id'], raw: true });
  return w ? (w as unknown as { user_id: number }).user_id : null;
}

/** 金额取整到分（元） */
const round2 = (n: number) => Math.round(Number(n) * 100) / 100;

/** calcHourlyFee 入参：订单行（用到 started_at / hourly_price / budget） */
interface HourlyOrder {
  started_at: string | null;
  hourly_price: string | number;
  budget: string | number;
}

/**
 * hourly 单中途结算实收公式（abort / 服务中取消共用）：
 *   hours = ceil(已服务分钟 / 30) × 0.5；实收 = hourly_price × hours，上限为已付金额（未支付则为预算）
 */
function calcHourlyFee(order: HourlyOrder) {
  const start = order.started_at ? new Date(String(order.started_at).replace(' ', 'T')) : null;
  const minutes = start ? Math.max(0, (Date.now() - start.getTime()) / 60000) : 0;
  const hours = Math.ceil(minutes / 30) * 0.5;
  const raw = Number(order.hourly_price) * hours;
  const cap = Number(order.budget) || 0; // 支付金额 = 下单预算（pay.service.amountCents 同口径）
  const fee = cap > 0 ? Math.min(raw, cap) : raw;
  return { minutes: Math.round(minutes), hours, fee: round2(fee) };
}

/** 服务费（10% 平台抽成） */
const serviceFeeOf = (amount: number) => round2(amount * config.serviceRate);

async function mustOrder(id: number): Promise<JoinedOrderRow> {
  const row = await findJoinedOrder({ id });
  if (!row) throw notFound('订单不存在');
  return row;
}

/** 校验订单当前状态，否则 409 */
function assertStatus(order: JoinedOrderRow, allowed: OrderStatus[]) {
  if (!allowed.includes(order.status)) {
    throw conflict(`当前状态「${STATUS_TEXT[order.status]}」不可执行该操作`);
  }
}

/** 只有下单客户 / 接单师傅 / 管理员可见 */
async function assertVisible(order: JoinedOrderRow, user: JwtPayload) {
  if (user.role === 'admin') return;
  if (order.customer_id === user.id) return;
  if (order.worker_id) {
    const w = await getWorkerId(user.id);
    if (w && w.id === order.worker_id) return;
  }
  throw forbidden('无权查看该订单');
}

/**
 * CAS 更新状态：只有 from 状态才允许改，避免并发抢单
 * 语义对齐原 SQL `UPDATE ... WHERE id = ? AND status IN (...)` 的 affectedRows === 1 判定：
 * 连接 flags:''（CLIENT_FOUND_ROWS）下 affectedCount = 匹配行数（no-op 更新也计 1），
 * 事务内烟测验证：命中=1 / 未命中=0 / 同单连续两次推进第二次=0。
 */
async function casStatus(orderId: number, fromList: OrderStatus[], to: OrderStatus, extra: Record<string, unknown> = {}) {
  const [affected] = await Order.update(
    { status: to, ...extra } as Record<string, any>,
    { where: { id: orderId, status: { [Op.in]: fromList } } },
  );
  if (affected === 0) throw conflict('订单状态已变化，请刷新后重试');
}

async function addLog(orderId: number, action: string, from: string, to: string, user: JwtPayload, content: string) {
  await OrderLog.create({
    order_id: orderId,
    action,
    from_status: from,
    to_status: to,
    operator_id: user.id,
    operator_role: user.role,
    content,
  });
}

function pageResult<T>(list: T[], total: number, p: number, size: number) {
  return { list, total, page: p, page_size: size };
}

/* ----------------------------- 客户端 ----------------------------- */

/** 客户下单（支持固定类目或自定义服务类型） */
export async function create(user: JwtPayload, body: Record<string, any>) {
  const { category_id, custom_category, title, description = '', address, lat, lng, expect_at, budget } = body;

  if (!title || !address || budget === undefined || budget === '') {
    throw badRequest('标题、地址、预算必填');
  }
  if (Number(budget) <= 0) throw badRequest('预算需大于 0');

  // 低分惩罚拦截：受限客户禁止发单（到期自动解除）
  await restrictService.assertCustomerActive(user.id);

  // 退款政策 / 计费方式（下单时锁定，不可修改，见 docs/API.md §3）
  const refundPolicy = body.refund_policy || 'flexible';
  if (!['flexible', 'strict'].includes(refundPolicy)) throw badRequest('退款政策只能是 flexible/strict');
  const billingType = body.billing_type || 'fixed';
  if (!['fixed', 'hourly'].includes(billingType)) throw badRequest('计费方式只能是 fixed/hourly');
  let hourlyPrice = 0;
  if (billingType === 'hourly') {
    hourlyPrice = Number(body.hourly_price) || 0;
    if (!(hourlyPrice > 0)) throw badRequest('时薪计费需填写时薪单价');
  }

  // 服务类型：固定类目 / 自定义 二选一（custom_category 优先）
  const custom = String(custom_category || '').trim();
  let catId: number | null = null;
  if (custom) {
    if (custom.length > 30) throw badRequest('自定义服务类型不能超过 30 字');
  } else if (category_id) {
    const cat = await ServiceCategory.findOne({ where: { id: category_id, status: 1 }, raw: true });
    if (!cat) throw badRequest('该服务类目不存在或已下架');
    catId = Number(category_id);
  } else {
    throw badRequest('请选择服务类型或填写自定义类型');
  }

  const orderNo = genOrderNo();
  const created = await Order.create({
    order_no: orderNo,
    customer_id: user.id,
    category_id: catId,
    custom_category: catId ? '' : custom,
    title,
    description,
    address,
    lng: lng || null,
    lat: lat || null,
    expect_at: expect_at || null,
    budget,
    status: 'pending',
    source: 'customer',
    refund_policy: refundPolicy,
    billing_type: billingType,
    hourly_price: hourlyPrice,
  });
  await addLog(created.id, 'create', '', 'pending', user, '客户提交需求');
  return { order: formatOrder(await mustOrder(created.id)) };
}

/** 接单大厅：待接单且未被指派（受限师傅 403，到期自动解除） */
export async function hall(params: PageParams, user?: JwtPayload | null) {
  const { p, size, offset } = paging(params);
  // 挂在登录子路由上：师傅访问时校验受限状态（其他角色保持原有行为不拦截）
  if (user && user.role === 'worker') {
    const w = await getWorkerId(user.id);
    if (w) await restrictService.assertWorkerActive(w);
  }
  // WHERE 条件：只查 pending 且未派单，后续可通过 params 动态追加条件
  const where: WhereOptions = { status: 'pending', worker_id: null };
  const { count, rows } = await Order.findAndCountAll({
    where,
    include: orderInclude(),
    raw: true,
    nest: true,
    limit: size,
    offset: offset,
    order: [['created_at', 'DESC']],
  });
  const total = Number(count);
  const rowsMapped = (rows as unknown as any[]).map(flattenOrder).map(formatOrder);
  return pageResult(rowsMapped, total, p, size);
}

/** 我的订单（按角色过滤） */
export async function mine(user: JwtPayload, params: PageParams) {
  const { p, size, offset } = paging(params);
  const { role = user.role, status } = params;
  const where: WhereOptions = {};

  if (role === 'customer') {
    where.customer_id = user.id;
  } else if (role === 'worker') {
    const w = await getWorkerId(user.id);
    if (!w) return pageResult([], 0, p, size);
    where.worker_id = w.id;
  } else {
    throw badRequest('role 只能是 customer 或 worker');
  }

  if (status) {
    where.status = status;
  }

  const { count, rows } = await Order.findAndCountAll({
    where,
    include: orderInclude(),
    raw: true,
    nest: true,
    limit: size,
    offset: offset,
    order: [['created_at', 'DESC']],
  });

  const total = Number(count);
  const rowsMapped = (rows as unknown as any[]).map(flattenOrder).map(formatOrder);
  return pageResult(rowsMapped, total, p, size);
}

/** 订单详情返回结构 */
export interface OrderDetailResult {
  order: FormattedOrder;
  customer: { id: number; name: string; phone: string };
  worker: { id: number; name: string | null; phone: string | null; rating: string | number | null } | null;
  logs: Array<{
    id: number;
    action: string;
    from_status: string;
    to_status: string;
    operator_name: string;
    operator_role: string;
    content: string;
    created_at: string;
  }>;
  wallet_logs?: Array<{
    id: number;
    type: string;
    amount: number;
    balance_after: number;
    remark: string;
    created_at: string;
  }>;
}

/** 订单详情（含操作流水） */
export async function detail(id: number, user: JwtPayload): Promise<OrderDetailResult> {
  const order = await mustOrder(id);
  await assertVisible(order, user);
  // 通过模型关联查询 order_logs，自动 LEFT JOIN users 取 operator name
  const logs = await OrderLog.findAll({
    where: { order_id: id },
    include: [{ model: User, as: 'operator', attributes: ['name'], required: false }],
    order: [['created_at', 'ASC'], ['id', 'ASC']],
  });
  return {
    order: formatOrder(order),
    customer: { id: order.customer_id, name: order.customer_name, phone: order.customer_phone },
    worker: order.worker_id
      ? { id: order.worker_id, name: order.worker_name, phone: order.worker_phone, rating: order.worker_agg_rating }
      : null,
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      from_status: l.from_status,
      to_status: l.to_status,
      operator_name: ((l as any).operator && (l as any).operator.name) || '系统',
      operator_role: l.operator_role,
      content: l.content,
      created_at: l.created_at,
    })),
  };
}

/* ----------------------------- 师傅端动作 ----------------------------- */

async function mustWorker(user: JwtPayload): Promise<WorkerRow> {
  const w = await getWorkerId(user.id);
  if (!w) throw forbidden('请先完成师傅入驻认证');
  if (w.status !== 'approved') throw forbidden('师傅认证未通过，暂时无法接单');
  return w;
}

/** 抢单（pending 且未被派单） */
export async function accept(id: number, user: JwtPayload) {
  const worker = await mustWorker(user);
  // 低分惩罚拦截：受限师傅禁止抢单（到期自动解除）
  await restrictService.assertWorkerActive(worker);
  const order = await mustOrder(id);
  assertStatus(order, ['pending', 'dispatched']);
  payService.assertPaidForDispatch(order); // PAY_STRICT=1 时未支付订单禁止抢单
  if (order.worker_id && order.worker_id !== worker.id) throw conflict('该订单已被派给其他师傅');
  if (order.status === 'pending' && order.worker_id) throw conflict('该订单已被指派');

  await casStatus(id, ['pending', 'dispatched'], 'accepted', { worker_id: worker.id, accepted_at: new Date() });
  // 原 `UPDATE workers SET order_count = order_count + 1 WHERE id = ?`
  await Worker.increment({ order_count: 1 }, { where: { id: worker.id } });
  await addLog(id, 'accept', order.status, 'accepted', user, '师傅确认接单');
  // 通知：师傅接单 → 客户
  await notificationService.notify(order.customer_id, id, NOTIFICATION_TYPE.accept, '师傅已接单',
    `订单 ${order.order_no} 已由 ${worker.real_name || '师傅'} 接单，请保持电话畅通`);
  return { order: formatOrder(await mustOrder(id)) };
}

/** 开始服务 */
export async function start(id: number, user: JwtPayload) {
  const worker = await mustWorker(user);
  const order = await mustOrder(id);
  if (order.worker_id !== worker.id) throw forbidden('只有接单师傅可以操作');
  assertStatus(order, ['accepted']);
  await casStatus(id, ['accepted'], 'working', { started_at: new Date() });
  await addLog(id, 'start', 'accepted', 'working', user, '师傅已上门开工');
  return { order: formatOrder(await mustOrder(id)) };
}

/** 提交完工（填写结算金额） */
export async function finish(id: number, user: JwtPayload, { price, remark = '' }: Record<string, any>) {
  const worker = await mustWorker(user);
  const order = await mustOrder(id);
  if (order.worker_id !== worker.id) throw forbidden('只有接单师傅可以操作');
  assertStatus(order, ['working']);
  if (!price || Number(price) <= 0) throw badRequest('请填写结算金额');

  const amount = Number(price);
  const fee = Math.round(amount * config.serviceRate * 100) / 100;
  await casStatus(id, ['working'], 'finished', {
    price: amount,
    service_fee: fee,
    finish_remark: remark,
    finished_at: new Date(),
  });
  await addLog(id, 'finish', 'working', 'finished', user, `师傅提交完工，结算 ¥${amount.toFixed(2)}`);
  // 通知：师傅完工 → 客户确认
  await notificationService.notify(order.customer_id, id, NOTIFICATION_TYPE.finish, '订单待确认',
    `订单 ${order.order_no} 已提交完工，结算金额 ¥${amount.toFixed(2)}，请确认完成`);
  return { order: formatOrder(await mustOrder(id)) };
}

/** 撤回完工（回退到服务中） */
export async function revokeFinish(id: number, user: JwtPayload) {
  const worker = await mustWorker(user);
  const order = await mustOrder(id);
  if (order.worker_id !== worker.id) throw forbidden('只有接单师傅可以操作');
  assertStatus(order, ['finished']);
  await casStatus(id, ['finished'], 'working', { finished_at: null });
  await addLog(id, 'revoke', 'finished', 'working', user, '师傅撤回完工提交');
  return { order: formatOrder(await mustOrder(id)) };
}

/* ----------------------------- 客户 / 运营 动作 ----------------------------- */

/** 确认完成 → 结算入账（finished / aborted 两种入账口径：aborted 按 actual_fee） */
export async function confirm(id: number, user: JwtPayload) {
  const order = await mustOrder(id);
  assertStatus(order, ['finished', 'aborted']);
  if (user.role === 'customer' && order.customer_id !== user.id) throw forbidden('只有下单客户可以确认');

  const fromStatus = order.status;
  // aborted（中途结束）：结算金额用 actual_fee；finished：沿用 finish 时写入的 price/service_fee
  const isAbort = fromStatus === 'aborted';
  const settle = isAbort ? round2(Number(order.actual_fee)) : round2(Number(order.price));
  const fee = isAbort ? serviceFeeOf(settle) : round2(Number(order.service_fee));

  await transaction(async (t) => {
    const [affected] = isAbort
      ? await Order.update(
          { status: 'completed', completed_at: new Date() as unknown as string, price: settle, service_fee: fee },
          { where: { id, status: 'aborted' }, transaction: t },
        )
      : await Order.update(
          { status: 'completed', completed_at: new Date() as unknown as string },
          { where: { id, status: 'finished' }, transaction: t },
        );
    if (affected === 0) throw conflict('订单状态已变化，请刷新后重试');

    const income = round2(settle - fee);
    if (order.worker_id && income > 0) {
      const uw = await Worker.findOne({ where: { id: order.worker_id }, attributes: ['user_id'], raw: true, transaction: t });
      const userId = (uw as unknown as { user_id: number }).user_id;
      await Wallet.increment({ balance: income, income }, { where: { user_id: userId }, transaction: t });
      const w = await Wallet.findOne({ where: { user_id: userId }, attributes: ['balance'], raw: true, transaction: t });
      await WalletLog.create({
        user_id: userId,
        order_id: id,
        type: 'income',
        amount: income,
        balance_after: (w as unknown as { balance: string | number }).balance,
        remark: isAbort
          ? `订单 ${order.order_no} 中途结束结算入账（实收 ¥${settle.toFixed(2)}）`
          : `订单 ${order.order_no} 结算入账`,
      }, { transaction: t });
      await Worker.increment({ done_count: 1 }, { where: { id: order.worker_id }, transaction: t });
    }
    await OrderLog.create({
      order_id: id,
      action: 'confirm',
      from_status: fromStatus,
      to_status: 'completed',
      operator_id: user.id,
      operator_role: user.role,
      content: isAbort ? `确认中途结束结算，实收 ¥${settle.toFixed(2)}，已结算` : '确认完成，已结算',
    }, { transaction: t });
  });

  // 通知：客户确认结算 → 师傅
  if (order.worker_id) {
    const wuid = await workerUserId(order.worker_id);
    await notificationService.notify(wuid, id, NOTIFICATION_TYPE.confirm, '结算已入账',
      `订单 ${order.order_no} 客户已确认，¥${round2(settle - fee).toFixed(2)} 已入账钱包`);
  }
  return { order: formatOrder(await mustOrder(id)) };
}

/* ----------------------------- 评价（多维 + 双向） ----------------------------- */

/** 校验标签数组：≤3 个、每个为 ≤10 字字符串 */
function validateTags(tags: unknown): string[] {
  if (tags === undefined || tags === null) return [];
  if (!Array.isArray(tags)) throw badRequest('tags 必须是字符串数组');
  if (tags.length > 3) throw badRequest('快捷标签最多 3 个');
  return tags.map((t) => {
    const s = String(t).trim();
    if (!s) throw badRequest('标签不能为空');
    if (s.length > 10) throw badRequest('单个标签不能超过 10 字');
    return s;
  });
}

/** 校验 1-5 维度分（可空） */
function checkDim(v: unknown, name: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw badRequest(`${name}需为 1-5 的整数`);
  return n;
}

/** 客户 → 师傅多维评价（completed 后一次） */
export async function rate(id: number, user: JwtPayload, body: Record<string, any> = {}) {
  const { rating, skill, attitude, punctual, tags, comment = '' } = body;
  const order = await mustOrder(id);
  if (order.customer_id !== user.id) throw forbidden('只有下单客户可以评价');
  assertStatus(order, ['completed']);
  const r = Number(rating);
  if (!(r >= 1 && r <= 5)) throw badRequest('评分需在 1-5 之间');
  if (order.rating) throw conflict('该订单已评价');

  const dimSkill = checkDim(skill, '技术评分');
  const dimAttitude = checkDim(attitude, '态度评分');
  const dimPunctual = checkDim(punctual, '准时评分');
  const tagList = validateTags(tags);
  const rateTags = tagList.join(',');
  const commentText = String(comment || '').slice(0, 255);

  // 事务：落评分 + 更新师傅均分 + 低分惩罚检查（同一事务内取窗口均分）
  await transaction(async (t) => {
    const [affected] = await Order.update(
      { rating: r, rate_comment: commentText, rate_skill: dimSkill, rate_attitude: dimAttitude, rate_punctual: dimPunctual, rate_tags: rateTags },
      { where: { id, rating: null }, transaction: t }, // rating IS NULL（null 值 → IS NULL，与原 SQL 一致）
    );
    if (affected === 0) throw conflict('该订单已评价'); // 并发幂等
    if (order.worker_id) {
      // 增量更新师傅评分（演示用简单均值：新评分占 20% 权重）；r 已校验为 1-5 整数，literal 内联安全
      await Worker.update(
        { rating: literal(`ROUND(rating * 0.8 + ${r} * 0.2, 1)`) as unknown as number },
        { where: { id: order.worker_id }, transaction: t },
      );
      await OrderLog.create({
        order_id: id,
        action: 'rate',
        from_status: 'completed',
        to_status: 'completed',
        operator_id: user.id,
        operator_role: user.role,
        content: `客户评分 ${r} 星${commentText ? `：${commentText}` : ''}`,
      }, { transaction: t });
      // 低分惩罚：师傅近 N 单均分低于阈值 → 限制接单
      await restrictService.checkAfterRate(t, 'worker', order.worker_id, await workerUserId(order.worker_id));
    } else {
      await OrderLog.create({
        order_id: id,
        action: 'rate',
        from_status: 'completed',
        to_status: 'completed',
        operator_id: user.id,
        operator_role: user.role,
        content: `客户评分 ${r} 星${commentText ? `：${commentText}` : ''}`,
      }, { transaction: t });
    }
  });

  // 通知：收到评价 → 师傅
  if (order.worker_id) {
    const wuid = await workerUserId(order.worker_id);
    await notificationService.notify(wuid, id, NOTIFICATION_TYPE.rate, '收到客户评价',
      `订单 ${order.order_no} 客户给出 ${r} 星评价${commentText ? `：${commentText}` : ''}`);
  }
  return { order: formatOrder(await mustOrder(id)) };
}

/** 师傅 → 客户回评（completed 后一次，仅接单师傅） */
export async function rateWorker(id: number, user: JwtPayload, body: Record<string, any> = {}) {
  const { rating, tags, comment = '' } = body;
  const worker = await mustWorker(user);
  const order = await mustOrder(id);
  if (order.worker_id !== worker.id) throw forbidden('只有接单师傅可以评价客户');
  assertStatus(order, ['completed']);
  const r = Number(rating);
  if (!(r >= 1 && r <= 5)) throw badRequest('评分需在 1-5 之间');
  if (order.worker_rating !== null && order.worker_rating !== undefined) throw conflict('该订单已评价');

  const tagList = validateTags(tags);
  const rateTags = tagList.join(',');
  const commentText = String(comment || '').slice(0, 255);

  await transaction(async (t) => {
    const [affected] = await Order.update(
      { worker_rating: r, worker_rate_comment: commentText, worker_rate_tags: rateTags },
      { where: { id, worker_rating: null }, transaction: t }, // worker_rating IS NULL（并发幂等）
    );
    if (affected === 0) throw conflict('该订单已评价'); // 并发幂等
    await OrderLog.create({
      order_id: id,
      action: 'rate-worker',
      from_status: 'completed',
      to_status: 'completed',
      operator_id: user.id,
      operator_role: user.role,
      content: `师傅评价客户 ${r} 星${commentText ? `：${commentText}` : ''}`,
    }, { transaction: t });
    // 客户侧均分落库（users.rating，增量均值）+ 低分惩罚检查；r 已校验为 1-5 整数
    await User.update(
      { rating: literal(`ROUND(rating * 0.8 + ${r} * 0.2, 1)`) as unknown as number },
      { where: { id: order.customer_id }, transaction: t },
    );
    await restrictService.checkAfterRate(t, 'customer', order.customer_id, order.customer_id);
  });

  // 通知：收到评价 → 客户
  await notificationService.notify(order.customer_id, id, NOTIFICATION_TYPE.rate, '收到师傅评价',
    `订单 ${order.order_no} 师傅给出您 ${r} 星评价${commentText ? `：${commentText}` : ''}`);
  return { order: formatOrder(await mustOrder(id)) };
}

/* ----------------------------- 中途结束（aborted） ----------------------------- */

/**
 * 中途退出：working → aborted（docs/DESIGN-phase2.md §2.2）
 *  - hourly：服务端按公式自动算 actual_fee（半小时向上取整），忽略 price
 *  - fixed：price 必填 = 实收
 *  - 鉴权：接单师傅 / 运营（handling action:'abort' 复用本函数）
 */
export async function abort(id: number, user: JwtPayload, { reason = '', price }: Record<string, any> = {}) {
  const order = await mustOrder(id);
  assertStatus(order, ['working']);
  if (!reason || !String(reason).trim()) throw badRequest('请填写中途结束原因');
  // 权限：接单师傅本人 或 运营
  if (user.role === 'admin') {
    // 运营代操作：允许
  } else if (user.role === 'worker') {
    const worker = await mustWorker(user);
    if (order.worker_id !== worker.id) throw forbidden('只有接单师傅可以中止订单');
  } else {
    throw forbidden('只有接单师傅或运营可以中止订单');
  }
  let actualFee: number;
  let feeDesc: string;
  if (order.billing_type === 'hourly') {
    const { minutes, hours, fee } = calcHourlyFee(order);
    actualFee = fee;
    feeDesc = `${(minutes / 60).toFixed(2)}h（按 ${hours}h 计）× ¥${Number(order.hourly_price).toFixed(2)}`;
  } else {
    // 一口价单：必须填写实收金额
    if (price === undefined || price === null || price === '') throw badRequest('一口价订单请填写实收金额');
    const p = Number(price);
    if (!(p >= 0)) throw badRequest('实收金额不合法');
    actualFee = round2(p);
    feeDesc = `实收 ¥${actualFee.toFixed(2)}`;
  }
  // CAS 状态流转：working → aborted（affectedCount=0 即状态已变化）
  const [affected] = await Order.update(
    { status: 'aborted', actual_fee: actualFee, abort_reason: String(reason).trim(), aborted_at: new Date() } as Record<string, any>,
    { where: { id, status: { [Op.in]: ['working'] } } },
  );
  if (affected === 0) throw conflict('当前状态不可中止，请刷新后重试');
  await addLog(id, 'abort', 'working', 'aborted', user,
    `师傅中途结束订单，${feeDesc}，原因：${String(reason).trim()}`);
  // 通知：客户「待确认实收」、师傅「已提交」
  await notificationService.notify(order.customer_id, id, NOTIFICATION_TYPE.abort, '订单中途结束待确认',
    `订单 ${order.order_no} 已中途结束，实收 ¥${actualFee.toFixed(2)}（${feeDesc}），请确认结算`);
  if (order.worker_id) {
    await notificationService.notify(await workerUserId(order.worker_id), id, NOTIFICATION_TYPE.abort, '中途结束已提交',
      `订单 ${order.order_no} 中途结束已提交（${feeDesc}），等待客户确认结算`);
  }
  return { order: formatOrder(await mustOrder(id)) };
}
/* ----------------------------- 取消与退款决策表 ----------------------------- */

/**
 * 取消订单（退款决策表，docs/DESIGN-phase2.md §2.1 服务端强制）
 *  - 开工前（pending/dispatched/accepted）：cancelled + 已支付自动全额退款
 *  - working + flexible：按进度退款（hourly 按公式扣已服务时长；fixed 实收 0 全额退）
 *  - working + strict：409「按下单约定不支持中途退款」（订单不动，运营可手动退款/代取消）
 *  - 运营强制取消 working/finished：允许取消，退款走手动退款接口
 */
export async function cancel(id: number, user: JwtPayload, { reason = '' }: Record<string, any> = {}) {
  const order = await mustOrder(id);
  const isAdmin = user.role === 'admin';
  // 客户允许取消到 working（strict 会在决策表中 409 拒绝，flexible 按进度退款）
  const allowed: OrderStatus[] = isAdmin
    ? ['pending', 'dispatched', 'accepted', 'working', 'finished']
    : ['pending', 'dispatched', 'accepted', 'working'];
  if (user.role === 'customer' && order.customer_id !== user.id) throw forbidden('只有下单客户可以取消');
  if (user.role !== 'admin' && user.role !== 'customer') throw forbidden('只有下单客户或运营可以取消');
  if (user.role === 'customer' && !reason) throw badRequest('请填写取消原因');

  // ---- working 中取消：按退款政策强制执行（客户）----
  let progress: { actual_fee: number; refund_amount: number; refund_reason: string; log: string } | null = null;
  if (order.status === 'working' && !isAdmin) {
    if (order.refund_policy === 'strict') {
      throw conflict('按下单约定不支持中途退款');
    }
    // flexible：按进度结算
    if (order.billing_type === 'hourly') {
      const { minutes, hours, fee } = calcHourlyFee(order);
      const paid = round2(Number(order.budget));
      const actual = Math.min(fee, paid);
      const refundAmount = round2(Math.max(paid - actual, 0));
      progress = {
        actual_fee: actual,
        refund_amount: refundAmount,
        refund_reason: '服务中取消，按已服务时长结算',
        log: `服务中取消（flexible·hourly）：已服务 ${minutes} 分钟，按 ${hours}h × ¥${Number(order.hourly_price).toFixed(2)} 实收 ¥${actual.toFixed(2)}，应退 ¥${refundAmount.toFixed(2)}`,
      };
    } else {
      // fixed：协商实收 0，全额退款
      const paid = round2(Number(order.budget));
      progress = {
        actual_fee: 0,
        refund_amount: paid,
        refund_reason: '服务中取消，按已服务时长结算',
        log: `服务中取消（flexible·fixed）：fixed 单服务中取消，协商实收 0，全额退款 ¥${paid.toFixed(2)}`,
      };
    }
  }

  const extra = progress ? { actual_fee: progress.actual_fee } : {};
  // CAS 状态流转：allowed → cancelled（affectedCount=0 即状态已变化）
  const [affected] = await Order.update(
    { status: 'cancelled', cancelled_at: new Date(), cancel_reason: reason || '订单已取消', ...extra } as Record<string, any>,
    { where: { id, status: { [Op.in]: allowed } } },
  );
  if (affected === 0) throw conflict('当前状态不可取消，请刷新后重试');
  // worker order_count 自减（原子自减，防并发）
  if (order.worker_id) {
    await Worker.increment({ order_count: -1 }, { where: { id: order.worker_id } });
  }

  // ---- 退款（退款决策表执行）----
  let refundResult: string | null = null;
  const preWork = ['pending', 'dispatched', 'accepted'].includes(order.status);
  if (preWork) {
    // 开工前取消：已支付 → 自动全额退款
    await addLog(id, 'cancel', order.status, 'cancelled', user, reason || '订单已取消');
    refundResult = await payService.onOrderCancelled(order, user, { reason: '开工前取消，全额退款' });
  } else if (progress) {
    // 服务中取消（flexible）：按进度退差额
    await addLog(id, 'cancel', order.status, 'cancelled', user, progress.log);
    refundResult = await payService.onOrderCancelled(order, user, {
      amount: progress.refund_amount,
      reason: progress.refund_reason,
    });
  } else {
    // 运营强制取消（working/finished）：不自动退款，留手动退款接口（带金额与审计）
    await addLog(id, 'cancel', order.status, 'cancelled', user,
      `${reason || '订单已取消'}（运营强制取消，退款请走「手动退款」接口）`);
  }

  if (order.worker_id) {
    await notificationService.notify(order.worker_id, id, NOTIFICATION_TYPE.cancel, '订单取消',
      `订单 ${order.order_no} 已取消，` + (progress ? `实收 ¥${progress.actual_fee.toFixed(2)}，` : '') + `原因：${reason || '订单已取消'}`);
  }
  if (order.customer_id) {
    await notificationService.notify(order.customer_id, id, NOTIFICATION_TYPE.cancel, '订单取消',
      `订单 ${order.order_no} 已取消，` + (progress ? `实收 ¥${progress.actual_fee.toFixed(2)}，` : '') + `原因：${reason || '订单已取消'}`);
  }
  void refundResult;
  return { order: formatOrder(await mustOrder(id)) };
}

/** 运营派单 / 改派（pending → dispatched，或改派 dispatched） */
export async function dispatch(id: number, user: JwtPayload, { worker_id }: Record<string, any>) {
  const order = await mustOrder(id);
  assertStatus(order, ['pending', 'dispatched']);
  payService.assertPaidForDispatch(order); // PAY_STRICT=1 时未支付订单禁止派单
  if (!worker_id) throw badRequest('请选择接单师傅');

  // 模型取数（原 `SELECT w.*, u.name AS user_name ... JOIN users u`），含 user 关联
  const wRow = await Worker.findOne({
    where: { id: worker_id },
    include: [{ model: User, as: 'user', attributes: ['name'], required: true }],
    raw: true,
    nest: true,
  });
  if (!wRow) throw notFound('师傅不存在');
  const worker = { ...(wRow as any), user_name: (wRow as any).user?.name } as WorkerRow & { user_name: string };
  if (worker.status !== 'approved') throw badRequest('该师傅未通过认证，无法派单');
  // 低分惩罚拦截：受限师傅不可被派单（到期自动解除）
  await restrictService.assertWorkerActive(worker);

  const from = order.status;
  await casStatus(id, ['pending', 'dispatched'], 'dispatched', {
    worker_id,
    dispatch_at: new Date(),
    source: 'admin',
  });
  await addLog(id, 'dispatch', from, 'dispatched', user, `运营指派给「${worker.real_name}」`);
  // 通知：运营派单 → 师傅
  await notificationService.notify(worker.user_id, id, NOTIFICATION_TYPE.dispatch, '新订单派单',
    `订单 ${order.order_no}（${order.title}）已派给您，请尽快接单`);
  return { order: formatOrder(await mustOrder(id)) };
}

/**
 * 运营代操作状态流转
 * action: start | finish | confirm | cancel | abort
 */
export async function handling(id: number, user: JwtPayload, { action, price, reason = '', remark = '' }: Record<string, any>) {
  const order = await mustOrder(id);
  switch (action) {
    case 'start':
      assertStatus(order, ['accepted']);
      await casStatus(id, ['accepted'], 'working', { started_at: new Date() });
      await addLog(id, 'start', 'accepted', 'working', user, '运营代操作：开始服务');
      break;
    case 'finish': {
      assertStatus(order, ['working']);
      const amount = Number(price || order.budget);
      if (!(amount > 0)) throw badRequest('请填写结算金额');
      const fee = Math.round(amount * config.serviceRate * 100) / 100;
      await casStatus(id, ['working'], 'finished', {
        price: amount,
        service_fee: fee,
        finish_remark: remark,
        finished_at: new Date(),
      });
      await addLog(id, 'finish', 'working', 'finished', user, `运营代操作：完工结算 ¥${amount.toFixed(2)}`);
      break;
    }
    case 'confirm':
      return confirm(id, user);
    case 'cancel':
      return cancel(id, user, { reason });
    case 'abort':
      // 代师傅中止（同样规则：hourly 自动算 / fixed 需 price）
      return abort(id, user, { reason, price });
    default:
      throw badRequest('action 不合法');
  }
  return { order: formatOrder(await mustOrder(id)) };
}

/* ----------------------------- 管理端查询 ----------------------------- */

export async function adminList(params: PageParams) {
  const { p, size, offset } = paging(params);
  const { status, keyword } = params;
  // WHERE 条件累加（全部通过 WhereOptions 传入，不手拼 SQL）
  const conditions: WhereOptions[] = [];
  if (status) {
    conditions.push({ status });
  }
  if (keyword) {
    // keyword 匹配订单号/标题/手机号/地址（含客户与接单师傅关联链）
    conditions.push({
      [Op.or]: [
        { order_no: { [Op.like]: `%${keyword}%` } },
        { title: { [Op.like]: `%${keyword}%` } },
        { address: { [Op.like]: `%${keyword}%` } },
        { '$customer.phone$': { [Op.like]: `%${keyword}%` } },
        { '$customer.name$': { [Op.like]: `%${keyword}%` } },
        { '$worker.user.phone$': { [Op.like]: `%${keyword}%` } },
        { '$worker.user.name$': { [Op.like]: `%${keyword}%` } },
      ],
    });
  }
  const where: WhereOptions = conditions.length ? { [Op.and]: conditions } : {};

  const { count, rows } = await Order.findAndCountAll({
    where,
    include: orderInclude(),
    raw: true,
    nest: true,
    limit: size,
    offset: offset,
    order: [['created_at', 'DESC']],
  });

  const total = Number(count);
  const rowsMapped = (rows as unknown as any[]).map(flattenOrder).map(formatOrder);
  return pageResult(rowsMapped, total, p, size);
}

export async function adminDetail(id: number): Promise<OrderDetailResult> {
  const base: OrderDetailResult = await detail(id, { id: -1, role: 'admin' });
  // 模型查询钱包流水（关联别名 l_worker = wallet_logs.user_id → workers.user_id，等价原 JOIN 语义）
  const walletLogs = await WalletLog.findAll({
    where: { order_id: id },
    include: [{
      model: Worker,
      as: 'l_worker',
      attributes: ['user_id'],
      required: true,
    }],
    order: [['id', 'DESC']],
    raw: true,
    nest: true,
  });
  base.wallet_logs = walletLogs.map((l) => ({
    id: l.id,
    type: l.type,
    amount: Number(l.amount),
    balance_after: Number(l.balance_after),
    remark: l.remark,
    created_at: l.created_at,
  }));
  return base;
}

/** 运营代客下单（支持固定类目 / 自定义类型 / 地图坐标） */
export async function adminCreate(user: JwtPayload, body: Record<string, any>) {
  const { customer_phone, customer_id, ...rest } = body;
  let customerId = customer_id;
  if (!customerId && customer_phone) {
    const c = await User.findOne({ where: { phone: customer_phone } });
    if (!c) throw notFound('客户不存在');
    customerId = c.id;
  }
  if (!customerId) throw badRequest('请提供客户手机号或客户 ID');
  if (!rest.title) throw badRequest('请填写订单标题');

  const custom = String(rest.custom_category || '').trim();
  let catId: number | null = null;
  if (custom) {
    if (custom.length > 30) throw badRequest('自定义服务类型不能超过 30 字');
  } else if (rest.category_id) {
    const cat = await ServiceCategory.findOne({ where: { id: rest.category_id } });
    if (!cat) throw badRequest('类目不存在');
    catId = cat.id;
  } else {
    throw badRequest('请选择服务类型或填写自定义类型');
  }

  const orderNo = genOrderNo();
  const order = await Order.create({
    order_no: orderNo,
    customer_id: customerId,
    category_id: catId,
    custom_category: custom || '',
    title: rest.title,
    description: rest.description || '',
    address: rest.address || '',
    lng: rest.lng || null,
    lat: rest.lat || null,
    expect_at: rest.expect_at || null,
    budget: rest.budget || 0,
    status: 'pending',
    source: 'admin',
  });
  await addLog(order.id, 'create', '', 'pending', user, '运营代客户下单');
  return { order: formatOrder(await mustOrder(order.id)) };
}

export { mustOrder, formatOrder };
