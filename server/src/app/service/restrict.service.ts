/**
 * 低分惩罚服务（阶段二 · docs/DESIGN-phase2.md §4.3）
 *  - 评价提交后事务内检查被评人近 RESTRICT_WINDOW 次被评均分
 *  - 低于 RESTRICT_MIN_RATING → restricted=1 + 原因 + 解除时间（now + RESTRICT_DAYS 天）+ 通知
 *  - 拦截点：师傅抢单 accept / 派单 dispatch / 客户下单 POST /orders / 接单大厅
 *  - 到期自动解除：拦截时发现 restricted_until < now → 清零放行；运营也可手动解除
 * Sequelize 迁移：workers/users 双表按类型分派到 Worker/User 模型；窗口取数在评价事务内传 transaction。
 */
import type { Transaction } from 'sequelize';
import { User, Worker, Order, Op } from '../../db/models';
import config from '../../config/config.default';
import { forbidden, notFound } from '../../util/response';
import { NOTIFICATION_TYPE } from '../../constant/notification.constant';
import * as notificationService from './notification.service';

const R = () => config.restrict;

/** 受限文案（三端统一）：账号受限中：{reason}，解除时间 {until} */
function restrictedError(reason: string, until: string) {
  return forbidden(`账号受限中：${reason}，解除时间 ${until}`);
}

/** 受限字段子集（users / workers 同构） */
interface RestrictFields {
  restricted: number | string;
  restricted_reason?: string | null;
  restricted_until?: string | null;
}

/**
 * 校验并放行（发现到期自动解除）
 * 入参为 users 或 workers 行的受限字段子集
 */
async function assertActive(row: RestrictFields | null, table: 'workers' | 'users', id: number) {
  if (!row || Number(row.restricted) !== 1) return;
  const until = row.restricted_until ? new Date(String(row.restricted_until).replace(' ', 'T')) : null;
  if (until && until.getTime() < Date.now()) {
    // 到期自动解除
    const values = { restricted: 0, restricted_reason: '', restricted_until: null };
    if (table === 'workers') {
      await Worker.update(values, { where: { id } });
    } else {
      await User.update(values, { where: { id } });
    }
    return;
  }
  throw restrictedError(row.restricted_reason || '账号评分过低', row.restricted_until || '');
}

/** 师傅接单/被派单前校验（入参为 workers 行） */
export async function assertWorkerActive(workerRow: RestrictFields & { id: number }) {
  await assertActive(workerRow, 'workers', workerRow.id);
}

/** 客户下单前校验（入参为 users.id） */
export async function assertCustomerActive(userId: number) {
  const row = await User.findOne({
    where: { id: userId },
    attributes: ['id', 'restricted', 'restricted_reason', 'restricted_until'],
  });
  await assertActive(row, 'users', userId);
}

/** 近 N 次被评均分（不足 N 次按实际条数；无评分返回 null） */
async function recentAvg(values: any[]) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + Number(b), 0);
  return Math.round((sum / values.length) * 100) / 100;
}

/** 是否低于阈值 */
function belowThreshold(avg: number | null) {
  return avg !== null && avg < R().minRating;
}

function fmtUntil(days: number) {
  const d = new Date(Date.now() + days * 24 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 置受限对象（事务内调用；t 可传入事务） */
interface RestrictTarget {
  table: 'workers' | 'users';
  id: number;
  userId: number | null;
  label: string;
}

/**
 * 置受限（事务内调用；t 可传入事务）
 * who: { table:'workers'|'users', id, userId(通知接收人), label:'师傅'|'客户' }
 */
async function applyRestrict(t: Transaction | null, who: RestrictTarget, avg: number, count: number) {
  const reason = `近${count}单平均评分${avg}以下（阈值 ${R().minRating}）`;
  const until = fmtUntil(R().days);
  const values = { restricted: 1, restricted_reason: reason, restricted_until: until };
  const opts = { where: { id: who.id }, ...(t ? { transaction: t } : {}) };
  if (who.table === 'workers') {
    await Worker.update(values, opts);
  } else {
    await User.update(values, opts);
  }
  // 通知与迁移前一致：notify 不纳入事务（notification 写失败本就静默）
  await notificationService.notify(who.userId, null, NOTIFICATION_TYPE.restrict, `${who.label}账号受限`,
    `${reason}，已限制${who.label === '师傅' ? '接单/派单' : '发单'}至 ${until}，请提升服务质量`);
  return { reason, until };
}

/**
 * 评价提交后的惩罚检查（在评价事务内调用）
 * @param t    事务
 * @param kind 'worker'（师傅被客户评）| 'customer'（客户被师傅评）
 * @param id   workers.id 或 users.id
 * @param userId 通知接收人 users.id
 */
export async function checkAfterRate(t: Transaction, kind: 'worker' | 'customer', id: number, userId: number | null) {
  const { window } = R();
  let values: any[] = [];
  if (kind === 'worker') {
    // 师傅：orders.rating 最近 N 条有评分单
    const rows = await Order.findAll({
      attributes: ['rating'],
      where: { worker_id: id, rating: { [Op.ne]: null } },
      order: [['completed_at', 'DESC'], ['id', 'DESC']],
      limit: window,
      transaction: t,
      raw: true,
    });
    values = rows.map((r: any) => r.rating);
  } else {
    // 客户：worker_rating 最近 N 条有评分单（师傅→客户）
    const rows = await Order.findAll({
      attributes: ['worker_rating'],
      where: { customer_id: id, worker_rating: { [Op.ne]: null } },
      order: [['completed_at', 'DESC'], ['id', 'DESC']],
      limit: window,
      transaction: t,
      raw: true,
    });
    values = rows.map((r: any) => r.worker_rating);
  }
  const avg = await recentAvg(values);
  if (!belowThreshold(avg)) return null;

  const table = kind === 'worker' ? 'workers' : 'users';
  const label = kind === 'worker' ? '师傅' : '客户';
  return applyRestrict(t, { table, id, userId, label }, avg as number, values.length);
}

/* ----------------------------- 运营手动解除 ----------------------------- */

export async function unrestrictWorker(id: number) {
  const w = await Worker.findByPk(id, { attributes: ['id'] });
  if (!w) throw notFound('师傅不存在');
  await Worker.update(
    { restricted: 0, restricted_reason: '', restricted_until: null },
    { where: { id } },
  );
  return { id: Number(id), restricted: 0 };
}

export async function unrestrictCustomer(id: number) {
  const u = await User.findOne({ where: { id, role: 'customer' }, attributes: ['id'] });
  if (!u) throw notFound('客户不存在');
  await User.update(
    { restricted: 0, restricted_reason: '', restricted_until: null },
    { where: { id } },
  );
  return { id: Number(id), restricted: 0 };
}

export { restrictedError };
