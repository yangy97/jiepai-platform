/**
 * 管理端服务：概览 / 师傅审核 / 客户 / 类目 CRUD
 * Sequelize 全迁移：所有查询走模型，复杂聚合使用 fn/col + group 或 JS 归并，不写原生 SQL。
 */
import { Op, fn, col, literal } from 'sequelize';
import { Order, ServiceCategory, Worker, User } from '../../db/models';
import { flattenOrder, orderInclude } from '../../db/order-join';
import { paging } from './order.service';
import { STATUS_TEXT } from '../../constant/order.constant';
import { formatOrder } from '../../util/format';
import { badRequest, notFound, conflict } from '../../util/response';
import { formatWorker } from './worker.service';
import type { OrderStatus, WorkerStatus } from '../../types';

/* --------------------------- 概览看板 --------------------------- */

export async function dashboard() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const trendSince = new Date(dayStart.getTime() - 6 * 86400000); // 近 7 个自然日（含今天）

  // 并行查询多个统计值（原为单条多子查询 SQL，语义逐项对齐）
  const [
    orderCount,
    todayCount,
    pendingDispatch,
    doingCount,
    workerCount,
    approvedWorkerCount,
    customerCount,
    doneAmountResult,
    avgRow,
  ] = await Promise.all([
    Order.count(),
    Order.count({ where: { created_at: { [Op.gte]: dayStart } } }),
    Order.count({ where: { status: 'pending' } }),
    Order.count({ where: { status: { [Op.in]: ['dispatched', 'accepted', 'working'] } } }),
    Worker.count(),
    Worker.count({ where: { status: 'approved' } }),
    User.count({ where: { role: 'customer' } }),
    Order.sum('price', { where: { status: 'completed' } }),
    Order.findOne({
      attributes: [[fn('AVG', col('rating')), 'avg']],
      where: { rating: { [Op.ne]: null } },
      raw: true,
    }),
  ]);
  const avgRatingResult = Number((avgRow as any)?.avg || 5);

  // 近 7 日订单趋势（按自然日分组，DATE_FORMAT 与原 SQL 一致）
  const trendRows = (await Order.findAll({
    attributes: [
      [fn('DATE_FORMAT', fn('MIN', col('created_at')), '%m-%d'), 'date'],
      [fn('COUNT', col('*')), 'count'],
    ],
    where: {
      created_at: { [Op.gte]: trendSince },
    },
    group: [fn('DATE_FORMAT', col('created_at'), '%Y-%m-%d')],
    order: [[literal('MIN(created_at)'), 'ASC']],
    raw: true,
  })) as unknown as Array<{ date: string; count: number | string }>;

  // 补齐没有订单的日期
  const trend: Array<{ date: string; count: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hit = trendRows.find((r) => r.date === mmdd);
    trend.push({ date: mmdd, count: hit ? Number(hit.count) : 0 });
  }

  // 状态分布
  const statusRows = (await Order.findAll({
    attributes: ['status', [fn('COUNT', col('*')), 'count']],
    group: ['status'],
    raw: true,
  })) as unknown as Array<{ status: string; count: number | string }>;
  const status_dist = statusRows.map((r) => ({
    status: r.status,
    text: STATUS_TEXT[r.status as OrderStatus] || r.status,
    count: Number(r.count),
  }));

  // 最近 8 条订单（四表 include + flatten，与列表同契约）
  const recentRows = await Order.findAll({
    include: orderInclude(),
    order: [['created_at', 'DESC']],
    limit: 8,
    raw: true,
    nest: true,
  });
  const recent = (recentRows as unknown as any[]).map((r) => formatOrder(flattenOrder(r)));

  return {
    stat: {
      order_count: Number(orderCount),
      today_count: Number(todayCount),
      pending_dispatch: Number(pendingDispatch),
      doing: Number(doingCount),
      worker_count: Number(workerCount),
      approved_worker_count: Number(approvedWorkerCount),
      customer_count: Number(customerCount),
      done_amount: Number(doneAmountResult || 0),
      avg_rating: avgRatingResult ? Math.round(avgRatingResult * 10) / 10 : 5,
    },
    trend,
    status_dist,
    recent,
  };
}

/* --------------------------- 师傅管理 --------------------------- */

export async function workerList(params: Record<string, any>) {
  const { p, size, offset } = paging(params);
  const { status, keyword } = params;

  const where: any = {};
  if (status) {
    where.status = status;
  }
  if (keyword) {
    where[Op.or] = [
      { '$user.name$': { [Op.like]: `%${keyword}%` } },
      { '$user.phone$': { [Op.like]: `%${keyword}%` } },
      { real_name: { [Op.like]: `%${keyword}%` } },
      { region: { [Op.like]: `%${keyword}%` } },
    ];
  }

  // 总数
  const total = await Worker.count({
    where,
    include: [{ model: User, as: 'user', attributes: [], required: true }],
  });

  // 列表 - FIELD 排序（待审优先），关联带出 user 手机号/姓名
  const rows = await Worker.findAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['phone', 'name'], required: true }],
    order: [
      [literal("FIELD(`Worker`.`status`,'pending','approved','rejected','disabled')"), 'ASC'],
      ['id', 'DESC'],
    ],
    limit: size,
    offset,
    raw: true,
    nest: true,
  });

  // 扁平化
  const list = (rows as any[]).map((r) => formatWorker(r, { phone: r.user?.phone, name: r.user?.name }));
  return { list, total, page: p, page_size: size };
}

export async function workerDetail(id: number) {
  const w = await Worker.findByPk(id, {
    include: [{ model: User, as: 'user', attributes: ['id', 'phone', 'name', 'avatar'], required: false }],
  });
  if (!w) throw notFound('师傅不存在');
  const wj = w.toJSON() as any;
  const user = wj.user ?? null;
  delete wj.user;

  // 订单统计
  const [doingResult, doneResult, cancelledResult] = await Promise.all([
    Order.count({ where: { worker_id: id, status: { [Op.in]: ['dispatched', 'accepted', 'working'] } } }),
    Order.count({ where: { worker_id: id, status: 'completed' } }),
    Order.count({ where: { worker_id: id, status: 'cancelled' } }),
  ]);

  // 技能类目（skills 为 CSV '1,2,3' → 拆成数字 id 再查）
  const skillIds = String(w.skills || '').split(',').map(Number).filter((n) => n > 0);
  const cats = skillIds.length
    ? await ServiceCategory.findAll({ where: { id: { [Op.in]: skillIds } }, raw: true })
    : [];

  // 最近订单（四表 include + flatten，与列表同契约）
  const orders = await Order.findAll({
    where: { worker_id: id },
    include: orderInclude(),
    order: [['created_at', 'DESC']],
    limit: 10,
    raw: true,
    nest: true,
  });
  const recent_orders = (orders as unknown as any[]).map((r) => formatOrder(flattenOrder(r)));

  return {
    worker: { ...wj, skill_list: cats },
    user,
    counts: {
      doing: Number(doingResult),
      done: Number(doneResult),
      cancelled: Number(cancelledResult),
    },
    recent_orders,
  };
}

export async function workerAudit(id: number, { status, remark = '' }: { status?: string; remark?: string }) {
  if (!['approved', 'rejected'].includes(status as string)) throw badRequest('status 只能是 approved/rejected');
  const w = await Worker.findByPk(id);
  if (!w) throw notFound('师傅不存在');
  await Worker.update(
    { status: status as WorkerStatus, audit_remark: remark, audited_at: new Date() as unknown as string },
    { where: { id } },
  );
  return { id, status };
}

export async function workerSetStatus(id: number, { status }: { status?: string }) {
  const map: Record<string, WorkerStatus> = { enabled: 'approved', disabled: 'disabled' };
  if (!map[status as string]) throw badRequest('status 只能是 enabled/disabled');
  const w = await Worker.findByPk(id);
  if (!w) throw notFound('师傅不存在');
  if (w.status === 'pending') throw badRequest('待审核账号请先完成审核');
  await Worker.update({ status: map[status as string] }, { where: { id } });
  return { id, status: map[status as string] };
}

/* --------------------------- 客户管理 --------------------------- */

export async function customerList(params: Record<string, any>) {
  const { p, size, offset } = paging(params);
  const { keyword } = params;

  const where: any = { role: 'customer' };
  if (keyword) {
    where[Op.or] = [
      { name: { [Op.like]: `%${keyword}%` } },
      { phone: { [Op.like]: `%${keyword}%` } },
    ];
  }

  const [rows, total] = await Promise.all([
    User.findAll({
      where,
      attributes: ['id', 'phone', 'name', 'avatar', 'rating', 'restricted', 'restricted_reason', 'restricted_until', 'created_at'],
      order: [['id', 'DESC']],
      limit: size,
      offset,
      raw: true,
    }),
    User.count({ where }),
  ]);

  // 订单统计（当前页客户 → 一次取全部相关订单，JS 归并：单量/完成量/完成额）
  const ids = (rows as unknown as any[]).map((r) => r.id);
  const orderRows = ids.length
    ? await Order.findAll({
        attributes: ['customer_id', 'status', 'price'],
        where: { customer_id: { [Op.in]: ids } },
        raw: true,
      })
    : [];
  const statMap = new Map<number, { order_count: number; done_count: number; total_spent: number }>();
  for (const r of orderRows as unknown as any[]) {
    const s = statMap.get(r.customer_id) || { order_count: 0, done_count: 0, total_spent: 0 };
    s.order_count += 1;
    if (r.status === 'completed') {
      s.done_count += 1;
      s.total_spent += Number(r.price) || 0;
    }
    statMap.set(r.customer_id, s);
  }

  const list = (rows as unknown as any[]).map((r) => {
    const s = statMap.get(r.id) || { order_count: 0, done_count: 0, total_spent: 0 };
    return {
      id: r.id,
      phone: r.phone,
      name: r.name,
      avatar: r.avatar,
      created_at: r.created_at,
      order_count: s.order_count,
      total_spent: s.total_spent,
      done_count: s.done_count,
      rating: r.rating === null ? null : Number(r.rating),
      restricted: Number(r.restricted) || 0,
      restricted_reason: r.restricted_reason || '',
      restricted_until: r.restricted_until || null,
    };
  });

  return { list, total, page: p, page_size: size };
}

/* --------------------------- 类目管理 --------------------------- */

function mapCat(r: any) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    min_price: Number(r.min_price),
    unit: r.unit,
    description: r.description,
    sort: r.sort,
    status: r.status,
    created_at: r.created_at,
  };
}

export async function categoryList() {
  const rows = await ServiceCategory.findAll({ order: [['sort', 'DESC'], ['id', 'ASC']], raw: true });
  return { list: (rows as any[]).map(mapCat) };
}

function checkCatBody(body: Record<string, any>, requireAll: boolean) {
  const { name, icon, min_price, unit, description = '', sort = 0, status = 1 } = body;
  if (requireAll && !name) throw badRequest('类目名称必填');
  if (min_price !== undefined && Number(min_price) < 0) throw badRequest('起步价不能为负');
  return {
    name: name || '',
    icon: icon || '🔧',
    min_price: Number(min_price) || 0,
    unit: unit || '次',
    description,
    sort: Number(sort) || 0,
    status: Number(status) === 0 ? 0 : 1,
  };
}

export async function categoryCreate(body: Record<string, any>) {
  const v = checkCatBody(body, true);
  const r = await ServiceCategory.create(v);
  return { id: r.id };
}

export async function categoryUpdate(id: number, body: Record<string, any>) {
  const exists = await ServiceCategory.findByPk(id, { attributes: ['id'] });
  if (!exists) throw notFound('类目不存在');
  const v = checkCatBody(body, false);
  if (!v.name) throw badRequest('类目名称必填');
  await ServiceCategory.update(v, { where: { id } });
  return { id: Number(id) };
}

export async function categoryRemove(id: number) {
  const exists = await ServiceCategory.findByPk(id, { attributes: ['id'] });
  if (!exists) throw notFound('类目不存在');
  const c = await Order.count({ where: { category_id: id } });
  if (c > 0) throw conflict(`该类目下已有 ${c} 个订单，无法删除，可改为下架`);
  await ServiceCategory.destroy({ where: { id } });
  return { id: Number(id) };
}
