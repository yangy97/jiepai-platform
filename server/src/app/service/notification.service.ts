/**
 * 站内通知服务（阶段二 · docs/DESIGN-phase2.md §3）
 *  - notify(): 事件落库辅助函数；任何失败只 warn 不抛出，绝不阻断主流程
 *  - list()/read(): 「我的消息」分页 + 未读数 / 标记已读
 *  - adminList(): 管理端全站通知分页（模型 include 关联 users/orders 带出名称与订单号）
 *  - startTimer(): 守时定时器（5 分钟一轮：预约前提醒 / 超时提醒，按 type+order_id 去重）
 *  - wxPush(): 微信订阅消息推送（SUBSCRIBE_MOCK 占位开关 + stable_token/subscribe/send 真实代码）
 */
import { Notification, Op, Order, OrderLog, User, Worker } from '../../db/models';
import { NOTIFICATION_TYPE, SUBSCRIBE_TEMPLATE_FIELDS } from '../../constant/notification.constant';
import config from '../../config/config.default';
import type { NotificationRow } from '../../types';

/** 数据库行 → Notification 结构 */
export function formatNotification(r: NotificationRow) {
  return {
    id: r.id,
    user_id: r.user_id,
    order_id: r.order_id,
    type: r.type,
    title: r.title,
    content: r.content,
    is_read: Number(r.is_read),
    created_at: r.created_at,
  };
}

/**
 * 事件落库（接收人 user_id 可为 null 的场景请先判空）
 * 失败静默：通知永远不能影响下单/派单/退款等主流程
 */
export async function notify(userId: number | null | undefined, orderId: number | null, type: string, title: string, content: string) {
  if (!userId) return null;
  try {
    const r = await Notification.create({
      user_id: userId,
      order_id: orderId || null,
      type,
      title: String(title).slice(0, 100),
      content: String(content).slice(0, 255),
    });
    // 微信订阅消息推送：fire-and-forget（wxPush 内部全捕获、绝不 reject，站内信已落库即达）
    void wxPush(userId, type, title, content);
    return r.id;
  } catch (err) {
    console.warn(`[notify] 通知写入失败（已忽略） type=${type}:`, (err as Error).message);
    return null;
  }
}

/* ----------------------------- 微信订阅消息推送 ----------------------------- */

/** access_token 进程内缓存（微信要求集中缓存；有效期 7200s，提前 5 分钟刷新防边界失效） */
let cachedAccessToken = '';
let accessTokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt) return cachedAccessToken;
  const { appid, appSecret } = config.pay; // 订阅消息与 code2session 共用小程序凭证
  if (!appid || !appSecret) throw new Error('未配置 WXPAY_APPID / WXPAY_APP_SECRET');
  const res = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid, secret: appSecret }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (data.errcode || !data.access_token) {
    throw new Error(`stable_token 失败（${data.errcode ?? '?'}）：${data.errmsg || '未知错误'}`);
  }
  cachedAccessToken = data.access_token;
  accessTokenExpiresAt = Date.now() + Math.max(60, (data.expires_in || 7200) - 300) * 1000;
  return cachedAccessToken;
}

/**
 * 微信订阅消息推送（一次性订阅：每授权 1 次 = 每模板可推 1 条）
 * - mock（SUBSCRIBE_MOCK=1，默认）：打 MOCK 日志即返回，不调微信
 * - 真实：查 users.openid → stable_token → POST /wxa/msg/subscribe/send
 * - 全程不抛异常：未配置模板 / 无 openid / 用户未授权（43101）/ 接口错误 → 一律 warn 后降级（站内信已兜底）
 * @returns 结果标记 {mock|sent|skipped|error}（仅供日志/排查，调用方不依赖）
 */
export async function wxPush(userId: number | null | undefined, type: string, title: string, content: string) {
  if (!userId) return { skipped: 'no_user' as const };
  try {
    const { mock, templates } = config.subscribe;
    const templateId = (templates[type] || '').trim();

    // ---------- mock：打日志即返回（占位模板 ID 也能看到推送动线） ----------
    if (mock) {
      console.log(`[subscribe] MOCK推送 user=${userId} type=${type} tmpl=${templateId || '(未配置)'} title=${title}`);
      return { mock: true as const };
    }

    // ---------- 真实通道 ----------
    if (!templateId) return { skipped: 'no_template' as const }; // 该类型未配模板 → 仅站内信

    const u = await User.findOne({ where: { id: userId }, attributes: ['openid'], raw: true });
    const openid = String((u as unknown as { openid?: string })?.openid || '');
    if (!openid) return { skipped: 'no_openid' as const }; // 未绑定微信（登录后 wx-code 接口写入）

    // 模板字段：key 需与 mp 后台所选模板一致（SUBSCRIBE_TEMPLATE_FIELDS 调整），值截断 20 字
    const fields = SUBSCRIBE_TEMPLATE_FIELDS[type] || ['thing1', 'thing2'];
    const values = [title, content];
    const data: Record<string, { value: string }> = {};
    fields.forEach((key, i) => {
      data[key] = { value: String(values[i] ?? '').slice(0, 20) };
    });

    const token = await getAccessToken();
    const res = await fetch(`https://api.weixin.qq.com/wxa/msg/subscribe/send?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touser: openid, template_id: templateId, data }),
    });
    const out = (await res.json()) as { errcode?: number; errmsg?: string };
    if (out.errcode === 43101) {
      // 用户未授权 / 一次性额度已用完 → 正常业务节律，仅提示
      console.warn(`[subscribe] 用户未订阅或额度已用完（已降级站内信） user=${userId} type=${type}`);
      return { skipped: 43101 as const };
    }
    if (out.errcode) {
      console.warn(`[subscribe] 推送失败（已降级站内信） type=${type} errcode=${out.errcode} ${out.errmsg || ''}`);
      return { error: out.errcode as number };
    }
    return { sent: true as const };
  } catch (err) {
    console.warn(`[subscribe] 推送异常（已降级站内信） type=${type}:`, (err as Error).message);
    return { error: (err as Error).message };
  }
}

/** 我的通知分页：?unread=1&page=&page_size= → { list, total, unread_count } */
export async function list(userId: number, params: Record<string, any> = {}) {
  const p = Math.max(1, Number(params.page) || 1);
  const size = Math.min(50, Math.max(1, Number(params.page_size) || 10));
  const unreadOnly = String(params.unread ?? '') === '1';
  const where = { user_id: userId, ...(unreadOnly ? { is_read: 0 } : {}) };
  const { rows, count } = await Notification.findAndCountAll({
    where,
    order: [['id', 'DESC']],
    limit: size,
    offset: (p - 1) * size,
  });
  const { unread_count: unreadCount } = await unreadCountOf(userId);
  return {
    list: rows.map((r) => formatNotification(r.get({ plain: true }) as unknown as NotificationRow)),
    total: count,
    unread_count: unreadCount,
    page: p,
    page_size: size,
  };
}

export async function unreadCountOf(userId: number) {
  const c = await Notification.count({ where: { user_id: userId, is_read: 0 } });
  return { unread_count: Number(c) };
}

/** 标记已读：ids 缺省 = 全部已读 */
export async function read(userId: number, ids?: unknown) {
  if (Array.isArray(ids) && ids.length) {
    const clean = ids.map(Number).filter((n) => n > 0);
    if (clean.length) {
      await Notification.update({ is_read: 1 }, { where: { user_id: userId, id: clean } });
    }
  } else {
    await Notification.update({ is_read: 1 }, { where: { user_id: userId, is_read: 0 } });
  }
  return unreadCountOf(userId);
}

/** 管理端：全站通知分页（?user_id=&type=&page=&page_size=；迁移前 LEFT JOIN users/orders） */
export async function adminList(params: Record<string, any> = {}) {
  const p = Math.max(1, Number(params.page) || 1);
  const size = Math.min(50, Math.max(1, Number(params.page_size) || 10));
  const where: Record<string, any> = {};
  if (params.user_id) where.user_id = Number(params.user_id);
  if (params.type) where.type = params.type;
  const { rows, count } = await Notification.findAndCountAll({
    where,
    include: [
      { model: User, as: 'n_user', attributes: ['name', 'phone'], required: false },
      { model: Order, as: 'n_order', attributes: ['order_no'], required: false },
    ],
    order: [['id', 'DESC']],
    limit: size,
    offset: (p - 1) * size,
    raw: true,
    nest: true, // raw 行内 include 嵌套为对象（否则键为 'n_user.name' 扁平串）
  });
  return {
    list: rows.map((r: any) => ({
      ...formatNotification(r as NotificationRow),
      user_name: r.n_user?.name || '',
      user_phone: r.n_user?.phone || '',
      order_no: r.n_order?.order_no || '',
    })),
    total: count,
    page: p,
    page_size: size,
  };
}

/** 同订单同类型是否已发过（定时器去重用） */
async function existsByOrderType(orderId: number, type: string) {
  const row = await Notification.findOne({ where: { order_id: orderId, type }, attributes: ['id'] });
  return !!row;
}

/* ----------------------------- 守时定时器 ----------------------------- */

/** tick 扫描行（JOIN 出师傅/客户 users.id） */
interface TickRow {
  id: number;
  order_no: string;
  expect_at: string | null;
  worker_id: number | null;
  worker_user_id: number | null;
  customer_id: number;
}

/**
 * 扫一轮（DESIGN §3.1）：
 *  - accepted 且 expect_at 落在 [now, now+30min] → start_remind（师傅，type+order_id 去重）
 *  - accepted 且 expect_at < now-30min → start_timeout（师傅+客户，去重）+ order_logs
 */
export async function tick() {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 60 * 1000);
  const before30 = new Date(now.getTime() - 30 * 60 * 1000);

  /** 模型取数：accepted 且预约时间命中窗口的订单（include worker 带出师傅 users.id） */
  async function scan(expectWhere: Record<string, any>): Promise<TickRow[]> {
    const rows = await Order.findAll({
      attributes: ['id', 'order_no', 'expect_at', 'worker_id', 'customer_id'],
      where: {
        status: 'accepted',
        expect_at: { [Op.ne]: null, ...expectWhere },
        worker_id: { [Op.ne]: null },
      },
      include: [{ model: Worker, as: 'worker', attributes: ['user_id'], required: false }],
      raw: true,
      nest: true,
    });
    return (rows as unknown as any[]).map((r) => ({
      id: r.id,
      order_no: r.order_no,
      expect_at: r.expect_at,
      worker_id: r.worker_id,
      worker_user_id: r.worker ? r.worker.user_id : null,
      customer_id: r.customer_id,
    }));
  }

  // 1) 预约前 30 分钟提醒
  const remindRows = await scan({ [Op.lte]: in30, [Op.gte]: now });
  for (const r of remindRows) {
    if (await existsByOrderType(r.id, NOTIFICATION_TYPE.start_remind)) continue;
    await notify(r.worker_user_id, r.id, NOTIFICATION_TYPE.start_remind, '上门时间提醒',
      `订单 ${r.order_no} 预约上门时间临近（${r.expect_at}），请按时到达`);
  }

  // 2) 超预约 30 分钟未开工
  const timeoutRows = await scan({ [Op.lt]: before30 });
  for (const r of timeoutRows) {
    if (await existsByOrderType(r.id, NOTIFICATION_TYPE.start_timeout)) continue;
    await notify(r.worker_user_id, r.id, NOTIFICATION_TYPE.start_timeout, '开工已超时',
      `订单 ${r.order_no} 已超预约时间 30 分钟仍未开工，请尽快上门或联系客户`);
    await notify(r.customer_id, r.id, NOTIFICATION_TYPE.start_timeout, '师傅开工超时',
      `订单 ${r.order_no} 师傅超过预约时间仍未开工，我们正在跟进处理`);
    try {
      await OrderLog.create({
        order_id: r.id,
        action: 'start_timeout',
        from_status: 'accepted',
        to_status: 'accepted',
        operator_id: null,
        operator_role: 'system',
        content: '超过预约时间 30 分钟未开工，已发送提醒通知',
      });
    } catch (err) {
      console.warn('[timer] order_logs 写入失败（已忽略）:', (err as Error).message);
    }
  }
  return { remind: remindRows.length, timeout: timeoutRows.length };
}

let timerStarted = false;

/** 启动定时器（server.js 调用；防重复注册 + unref 不阻塞进程退出） */
export function startTimer(intervalMs = 5 * 60 * 1000) {
  if (timerStarted) return null;
  timerStarted = true;
  const t = setInterval(() => {
    tick().catch((err) => {
      console.warn('[timer] 守时扫描失败（已忽略）:', (err as Error).message);
    });
  }, intervalMs);
  if (typeof t.unref === 'function') t.unref();
  console.log(`[timer] 守时扫描已启动：每 ${intervalMs / 60000} 分钟（预约前 30min 提醒 / 超时 30min 提醒）`);
  return t;
}
