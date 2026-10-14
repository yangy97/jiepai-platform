/**
 * 支付服务：发起支付（JSAPI）/ 回调处理 / 查询支付状态 / 整单退款
 *
 * 两条路径（由 PAY_MOCK 决定，配置见 docs/API.md「支付模式」）：
 *  - mock（PAY_MOCK=1）：直接事务内置 paid + MOCK 交易号 + 写操作流水，不调微信；
 *  - real（PAY_MOCK=0）：统一下单拿 prepay_id → 服务端签 paySign 返回给小程序拉起；
 *    支付结果以回调 handleNotify 置 paid（验签 + 解密 + 幂等），退款走 mTLS 退款接口；
 *
 * Sequelize 全迁移：查询走模型（Order/User/Worker/OrderLog），事务内模型调用
 * 全部传 { transaction: t }；CAS 判定用 Model.update 的 affectedCount === 1。
 */
import type { IncomingHttpHeaders } from 'http';
import type { Transaction } from 'sequelize';
import { transaction } from '../../db/pool';
import { Order, OrderLog, User, Worker } from '../../db/models';
import { findJoinedOrder } from '../../db/order-join';
import config from '../../config/config.default';
import { badRequest, forbidden, notFound, conflict } from '../../util/response';
import { PAY_STATUS_TEXT } from '../../constant/order.constant';
import { formatOrder } from '../../util/format';
import { NOTIFICATION_TYPE } from '../../constant/notification.constant';
import * as wechatpay from './wechatpay';
import * as notificationService from './notification.service';
import type { JoinedOrderRow, JwtPayload } from '../../types';

const isMock = () => config.pay.mock;

async function mustOrder(id: number): Promise<JoinedOrderRow> {
  const row = await findJoinedOrder({ id });
  if (!row) throw notFound('订单不存在');
  return row;
}

/** 订单操作流水（支付类动作：operator 可为系统/客户/运营） */
async function addPayLog(orderId: number, action: string, from: string, to: string, operator: JwtPayload | null | undefined, content: string) {
  await OrderLog.create({
    order_id: orderId,
    action,
    from_status: from,
    to_status: to,
    operator_id: operator ? operator.id : null,
    operator_role: operator ? operator.role : '',
    content,
  });
}

/** 订单金额（分）：以客户预估预算为准（支付与退款同口径） */
function amountCents(order: Pick<JoinedOrderRow, 'budget'>): number {
  return Math.round(Number(order.budget) * 100);
}

/** 尝试用 wx.login code 换 openid 并缓存到 users（失败静默，mock 演示不能因微信配置挂掉） */
async function tryCacheOpenid(userId: number, code?: string) {
  if (!code) return;
  try {
    const { openid } = await wechatpay.code2session(String(code));
    await User.update({ openid }, { where: { id: userId } });
  } catch (err) {
    console.warn('[pay] code2session 换 openid 失败（已忽略）：', (err as Error).message);
  }
}

/** openid：优先取库中缓存，其次用本次传入的 code 换取并存库 */
async function resolveOpenid(user: JwtPayload, body: Record<string, any>): Promise<string> {
  const u = await User.findOne({ where: { id: user.id } });
  if (u && u.openid) return u.openid;
  const code = body && body.code;
  if (!code) throw badRequest('缺少登录凭证 code');
  try {
    const { openid } = await wechatpay.code2session(String(code));
    await User.update({ openid }, { where: { id: user.id } });
    return openid;
  } catch (err) {
    throw badRequest(`获取微信登录凭证失败：${(err as Error).message}`);
  }
}

/* ----------------------------- 发起支付 ----------------------------- */

/**
 * POST /api/pay/orders/:id
 * 校验 → mock 直接置 paid；real 统一下单 + 签 paySign（此时不改订单状态，等回调）
 */
export async function createPayment(user: JwtPayload, orderId: number, body: Record<string, any> = {}) {
  const order = await mustOrder(orderId);
  if (order.customer_id !== user.id) throw forbidden('只有下单客户可以发起支付');
  if (order.pay_status !== 'unpaid') throw conflict('订单已支付，请勿重复支付');
  if (['completed', 'cancelled'].includes(order.status)) throw badRequest('订单已完成或已取消，无法支付');

  // ---------- mock：直接置 paid ----------
  if (isMock()) {
    await tryCacheOpenid(user.id, body.code);
    const now = new Date();
    const transactionId = `MOCK${Date.now()}`;
    await transaction(async (t) => {
      // CAS：pay_status='unpaid' → 'paid'（affectedCount=0 即并发重复支付）
      const [affected] = await Order.update(
        { pay_status: 'paid', paid_at: now, transaction_id: transactionId } as Record<string, any>,
        { where: { id: orderId, pay_status: 'unpaid' }, transaction: t },
      );
      if (affected === 0) throw conflict('订单已支付，请勿重复支付'); // 并发幂等
      await OrderLog.create({
        order_id: orderId,
        action: 'pay',
        from_status: 'unpaid',
        to_status: 'paid',
        operator_id: user.id,
        operator_role: user.role,
        content: '模拟支付成功',
      }, { transaction: t });
    });
    return { mock: true, paid: true, order: formatOrder(await mustOrder(orderId)) };
  }

  // ---------- real：JSAPI 统一下单 ----------
  const total = amountCents(order);
  if (!(total > 0)) throw badRequest('支付金额不能为 0');

  const openid = await resolveOpenid(user, body);
  const { appid, mchid, notifyUrl } = config.pay;
  const prepay = await wechatpay.postJson('/v3/pay/transactions/jsapi', {
    appid,
    mchid,
    description: order.title,
    out_trade_no: order.order_no,
    notify_url: notifyUrl,
    amount: { total, payer: { openid } },
    settle_info: { profit_sharing: false },
  });
  if (!prepay.prepay_id) throw badRequest('微信统一下单失败，未返回 prepay_id');

  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = wechatpay.randomNonce();
  const pkg = `prepay_id=${prepay.prepay_id}`;
  const paySign = wechatpay.signPayParams({ appid, nonceStr, package: pkg, timeStamp });

  // 注意：此阶段不改订单状态，支付结果以回调 / 轮询查询为准
  return { mock: false, payment: { timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign } };
}

/* ----------------------------- 支付回调 ----------------------------- */

/**
 * POST /api/pay/notify（微信服务器调用，无 token）
 * 验签失败 → 抛错（HTTP 400，微信会重试）；成功 → 返回微信应答体
 * trade_state=SUCCESS → 幂等置 paid；NOTPAY/CLOSED 等 → 不改状态仅成功应答
 */
export async function handleNotify(rawBody: Buffer, headers: IncomingHttpHeaders) {
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');

  // 1) 验签（原始 body + Wechatpay-* 头 + 平台证书，5 分钟时间戳容差）
  let platformCert: string;
  try {
    platformCert = wechatpay.loadPlatformCert();
  } catch (err) {
    throw badRequest(`回调验签失败：${(err as Error).message}`);
  }
  if (!wechatpay.verifyNotify(headers as Record<string, string>, bodyStr, platformCert)) {    throw badRequest('回调验签失败');
  }

  // 2) 解密 resource
  let notifyData: wechatpay.WxNotifyData;
  try {
    const resource = JSON.parse(bodyStr).resource || {};
    notifyData = wechatpay.decryptResource(
      resource.ciphertext,
      resource.nonce,
      config.pay.apiV3Key,
      resource.associated_data,
    );
  } catch (err) {
    throw badRequest(`回调报文解密失败：${(err as Error).message}`);
  }

  const { out_trade_no: outTradeNo, transaction_id: transactionId, trade_state: tradeState } = notifyData;
  const order = await findJoinedOrder({ order_no: outTradeNo });
  if (!order) throw badRequest(`订单不存在（order_no=${outTradeNo}）`);

  // 3) SUCCESS → 幂等置 paid
  if (tradeState === 'SUCCESS') {
    if (order.pay_status === 'paid') return { code: 'SUCCESS', message: '成功' }; // 已处理，直接应答
    await transaction(async (t) => {
      // CAS：unpaid → paid；affectedCount=0 说明并发下已置 paid，静默跳过流水
      const [affected] = await Order.update(
        { pay_status: 'paid', paid_at: new Date(), transaction_id: transactionId || '' } as Record<string, any>,
        { where: { id: order.id, pay_status: 'unpaid' }, transaction: t },
      );
      if (affected === 0) return;
      await OrderLog.create({
        order_id: order.id,
        action: 'pay',
        from_status: 'unpaid',
        to_status: 'paid',
        operator_id: order.customer_id,
        operator_role: 'customer',
        content: '微信支付成功',
      }, { transaction: t });
    });
    return { code: 'SUCCESS', message: '成功' };
  }

  // 4) NOTPAY / CLOSED / PAYERROR 等：不改状态，仅成功应答（避免微信无意义重试）
  return { code: 'SUCCESS', message: '成功' };
}

/* ----------------------------- 查询支付状态 ----------------------------- */

/** GET /api/pay/orders/:id（下单人 / 接单人 / admin 可见） */
export async function queryPayment(orderId: number, user: JwtPayload) {
  const order = await mustOrder(orderId);
  if (user.role !== 'admin' && order.customer_id !== user.id) {
    if (!order.worker_id) throw forbidden('无权查看该订单');
    // 权限：该 worker 必须属于当前登录用户
    const w = await Worker.findOne({ where: { user_id: user.id, id: order.worker_id } });
    if (!w) throw forbidden('无权查看该订单');
  }
  return {
    order: {
      id: order.id,
      pay_status: order.pay_status || 'unpaid',
      pay_status_text: PAY_STATUS_TEXT[order.pay_status] || order.pay_status,
      paid_at: order.paid_at || null,
    },
  };
}

/* ----------------------------- 退款 ----------------------------- */

/** 退款金额（分）→ 元，保留两位 */
const centsToYuan = (cents: number) => Math.round(cents) / 100;

/** 退款落库（事务内）：置 refunded + 退款明细（refund_amount / refund_reason）+ 操作流水 */
async function persistRefund(t: Transaction, order: JoinedOrderRow, refundCents: number, reason: string, refundId: string, operator: JwtPayload | null | undefined, logContent: string) {
  // CAS：pay_status='paid' → 'refunded'（重复退款 affectedCount=0 → conflict）
  const [affected] = await Order.update(
    {
      pay_status: 'refunded',
      refund_amount: centsToYuan(refundCents),
      refund_reason: reason,
      refunded_at: new Date(),
      refund_id: refundId,
    } as Record<string, any>,
    { where: { id: order.id, pay_status: 'paid' }, transaction: t },
  );
  if (affected === 0) throw conflict('该订单已退款，请勿重复退款');
  await OrderLog.create({
    order_id: order.id,
    action: 'refund',
    from_status: 'paid',
    to_status: 'refunded',
    operator_id: operator ? operator.id : null,
    operator_role: operator ? operator.role : 'system',
    content: logContent,
  }, { transaction: t });
}

/** 退款完成 → 给客户发站内通知 */
async function notifyRefund(order: JoinedOrderRow, refundCents: number, reason: string) {
  try {
    await notificationService.notify(order.customer_id, order.id, NOTIFICATION_TYPE.refund, '退款到账通知',
      `订单 ${order.order_no} 已退款 ¥${centsToYuan(refundCents).toFixed(2)}（${reason}）`);
  } catch (err) {
    console.warn('[pay] 退款通知失败（已忽略）:', (err as Error).message);
  }
}

/**
 * POST /api/admin/orders/:id/refund（admin 手动退款，支持部分金额）
 * body: { amount?, reason? }（缺省 = 实付全额）
 * - 已结算入账（paid + completed）→ 409 走线下退款；已退款 → 409；未支付 → 409
 * - mock → 直接落库；real → 调微信退款 API（mTLS，支持部分金额）成功后落库
 */
export async function refund(orderId: number, admin: JwtPayload, body: Record<string, any> = {}) {
  const order = await mustOrder(orderId);
  if (order.pay_status === 'refunded') throw conflict('该订单已退款，请勿重复退款');
  if (order.pay_status !== 'paid') throw conflict('订单未支付，无需退款');
  if (order.status === 'completed') throw conflict('已结算入账，请走线下退款');

  const paidCents = amountCents(order);
  let refundCents = paidCents;
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    const amt = Number(body.amount);
    if (!(amt > 0)) throw badRequest('退款金额需大于 0');
    refundCents = Math.round(amt * 100);
    if (refundCents > paidCents) {
      throw badRequest(`退款金额不能超过实付金额 ¥${centsToYuan(paidCents).toFixed(2)}`);
    }
  }
  const reason = String(body.reason || '').trim()
    || (refundCents === paidCents ? '运营整单退款' : `运营部分退款 ¥${centsToYuan(refundCents).toFixed(2)}`);

  if (isMock()) {
    const refundId = `MOCKRF${Date.now()}`;
    await transaction(async (t) => {
      await persistRefund(t, order, refundCents, reason, refundId, admin,
        `运营执行退款 ¥${centsToYuan(refundCents).toFixed(2)}（${reason}，模拟）`);
    });
    await notifyRefund(order, refundCents, reason);
    return { order: formatOrder(await mustOrder(orderId)) };
  }

  // real：微信退款接口需双向 TLS（amount.refund 支持部分金额）
  if (!(paidCents > 0)) throw badRequest('支付金额不能为 0，无法退款');
  const result = await wechatpay.postJsonWithCert('/v3/refund/domestics/refunds', {
    out_trade_no: order.order_no,
    out_refund_no: `RF${order.order_no}`,
    amount: { refund: refundCents, currency: 'CNY' },
  });
  if (!result.refund_id) throw badRequest(`微信退款失败：${result.errmsg || result.message || '未知错误'}`);

  await transaction(async (t) => {
    await persistRefund(t, order, refundCents, reason, result.refund_id, admin,
      `运营执行退款 ¥${centsToYuan(refundCents).toFixed(2)}（${reason}），退款单号 ${result.refund_id}`);
  });
  await notifyRefund(order, refundCents, reason);
  return { order: formatOrder(await mustOrder(orderId)) };
}

/* ----------------------------- 业务钩子（供 order.service 调用） ----------------------------- */

/** PAY_STRICT=1 时：派单 / 抢单入口校验订单已支付 */
export function assertPaidForDispatch(order: Pick<JoinedOrderRow, 'pay_status'>) {
  if (config.pay.strict && order.pay_status !== 'paid') throw conflict('订单未支付');
}

/** 已支付订单取消但不自动退款时记一条提示流水（运营强制取消 → 走手动退款接口） */
export async function onOrderCancelledNotice(order: JoinedOrderRow, operator: JwtPayload) {
  await addPayLog(order.id, 'notice', 'paid', 'paid', operator,
    '订单已支付，取消后未自动退款，请在管理端「手动退款」处理（支持金额与原因）');
  return 'notice';
}

/** 取消退款入参（金额缺省 = 实付全额） */
export interface CancelRefundOpts {
  amount?: unknown;
  reason?: string;
}

/**
 * 取消订单后的退款善后（退款决策表，docs/DESIGN-phase2.md §2.1）
 * 调用方（order.service.cancel）负责决定退款金额与原因：
 *  - 开工前取消 → opts 缺省 = 实付全额 + 「开工前取消，全额退款」
 *  - 服务中取消（flexible 按进度）→ opts.amount = 应退差额，opts.reason = 「服务中取消，按已服务时长结算」等
 * 返回：'refunded' 已退款 | 'settled' 实收=已付无需退款 | 'pending_refund' 真实模式退款失败待手动 | null 未支付
 */
export async function onOrderCancelled(order: JoinedOrderRow, operator: JwtPayload, opts: CancelRefundOpts = {}): Promise<'refunded' | 'settled' | 'pending_refund' | null> {
  if (order.pay_status !== 'paid') return null;

  const reason = opts.reason || '开工前取消，全额退款';
  const paidCents = amountCents(order);
  let refundCents = paidCents;
  if (opts.amount !== undefined && opts.amount !== null && opts.amount !== '') {
    refundCents = Math.round(Number(opts.amount) * 100);
    if (!(refundCents >= 0)) refundCents = 0;
    if (refundCents > paidCents) refundCents = paidCents;
  }

  // 实收 = 已付，无需退款（按进度结算的边界情况）
  if (refundCents <= 0) {
    await addPayLog(order.id, 'refund', 'paid', 'paid', operator, `取消订单：${reason}，按结算金额无需退款`);
    return 'settled';
  }

  if (isMock()) {
    const refundId = `MOCKRF${Date.now()}`;
    await transaction(async (t) => {
      await persistRefund(t, order, refundCents, reason, refundId, operator,
        `取消订单自动退款 ¥${centsToYuan(refundCents).toFixed(2)}（${reason}，模拟）`);
    });
    await notifyRefund(order, refundCents, reason);
    return 'refunded';
  }

  // 真实模式：调微信退款接口（支持部分金额）；失败不阻断取消，留管理端手动退
  try {
    const result = await wechatpay.postJsonWithCert('/v3/refund/domestics/refunds', {
      out_trade_no: order.order_no,
      out_refund_no: `RF${order.order_no}`,
      amount: { refund: refundCents, currency: 'CNY' },
    });
    if (!result.refund_id) throw new Error(result.errmsg || result.message || '未返回 refund_id');
    await transaction(async (t) => {
      await persistRefund(t, order, refundCents, reason, result.refund_id, operator,
        `取消订单自动退款 ¥${centsToYuan(refundCents).toFixed(2)}（${reason}），退款单号 ${result.refund_id}`);
    });
    await notifyRefund(order, refundCents, reason);
    return 'refunded';
  } catch (err) {
    await addPayLog(order.id, 'notice', 'paid', 'paid', operator,
      `取消订单自动退款失败：${(err as Error).message}，请在管理端手动退款`);
    return 'pending_refund';
  }
}
