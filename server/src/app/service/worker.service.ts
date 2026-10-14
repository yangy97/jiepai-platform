/**
 * 师傅档案服务：入驻 / 认证状态 / 统计
 * Sequelize 全迁移：CRUD/条件查询走 Worker/User/ServiceCategory/Order 模型；
 * 工作台收入汇总为模型取数 + JS 归并（分单位累加），无原生 SQL。
 */
import { Op, User, Worker, ServiceCategory, Order, Wallet } from '../../db/models';
import { badRequest } from '../../util/response';
import type { CategoryRow, WorkerProfileRow, WorkerStatus } from '../../types';

/** formatWorker 入参：workers 行（可带 JOIN 出的 u.phone / u.name） */
export interface FormatWorkerUser {
  phone?: string;
  name?: string;
}

/** formatWorker 返回结构（profile 会补 skill_list） */
export interface FormattedWorker {
  id: number;
  user_id: number;
  real_name: string;
  id_card: string;
  phone: string;
  name: string;
  region: string;
  skills: number[];
  years: number;
  bio: string;
  rating: number;
  order_count: number;
  done_count: number;
  status: WorkerStatus;
  status_text: string;
  audit_remark: string;
  audited_at: string | null;
  // 阶段二：低分惩罚受限信息（restricted / restricted_reason / restricted_until）
  restricted: number;
  restricted_reason: string;
  restricted_until: string | null;
  created_at: string;
  skill_list?: CategoryRow[];
}

export function formatWorker(row: WorkerProfileRow, user?: FormatWorkerUser | null): FormattedWorker;
export function formatWorker(row: WorkerProfileRow | null, user?: FormatWorkerUser | null): FormattedWorker | null;
export function formatWorker(row: WorkerProfileRow | null, user?: FormatWorkerUser | null): FormattedWorker | null {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    real_name: row.real_name,
    id_card: row.id_card,
    phone: user?.phone || (row as { phone?: string }).phone || '',
    name: user?.name || '',
    region: row.region,
    skills: String(row.skills || '').split(',').filter(Boolean).map(Number),
    years: row.years,
    bio: row.bio,
    rating: Number(row.rating),
    order_count: row.order_count,
    done_count: row.done_count,
    status: row.status,
    status_text: { pending: '待审核', approved: '已认证', rejected: '已驳回', disabled: '已停用' }[row.status] || row.status,
    audit_remark: row.audit_remark,
    audited_at: row.audited_at,
    // 阶段二：低分惩罚受限信息（restricted / restricted_reason / restricted_until）
    restricted: Number(row.restricted) || 0,
    restricted_reason: row.restricted_reason || '',
    restricted_until: row.restricted_until || null,
    created_at: row.created_at,
  };
}

/** 我的师傅档案（带类目名） */
export async function profile(userId: number) {
  const worker = await Worker.findOne({ where: { user_id: userId } });
  if (!worker) return { worker: null };
  const u = await User.findOne({ where: { id: userId }, attributes: ['phone', 'name'] });
  const data = formatWorker(worker, u ? { phone: u.phone, name: u.name } : null);
  const cats = data!.skills.length
    ? await ServiceCategory.findAll({
        where: { id: data!.skills },
        attributes: ['id', 'name', 'icon'],
        raw: true,
      })
    : [];
  data!.skill_list = cats as unknown as CategoryRow[];
  return { worker: data };
}

/** 提交 / 更新入驻认证 */
export async function apply(userId: number, body: Record<string, any>) {
  const { real_name, id_card, region, skills = [], years = 0, bio = '' } = body;
  if (!real_name || !region || !Array.isArray(skills) || skills.length === 0) {
    throw badRequest('真实姓名、服务区域、可接类目必填');
  }
  const exists = await Worker.findOne({ where: { user_id: userId } });

  if (exists && exists.status === 'approved') throw badRequest('已通过认证，无需重复提交');
  if (exists && exists.status === 'pending') throw badRequest('审核中，请耐心等待');

  const skillsCsv = skills.map(Number).join(',');
  if (exists) {
    await Worker.update(
      {
        real_name,
        id_card: id_card || '',
        region,
        skills: skillsCsv,
        years: Number(years) || 0,
        bio,
        status: 'pending',
        audit_remark: '',
      },
      { where: { id: exists.id } },
    );
  } else {
    await Worker.create({
      user_id: userId,
      real_name,
      id_card: id_card || '',
      region,
      skills: skillsCsv,
      years: Number(years) || 0,
      bio,
      status: 'pending',
    });
    await Wallet.create({ user_id: userId });
  }
  return profile(userId);
}

/** 师傅工作台统计 */
export async function stats(userId: number) {
  const w = await Worker.findOne({ where: { user_id: userId } });
  if (!w) return { doing: 0, done: 0, today_income: 0, month_income: 0, rating: 5, pending: 0 };

  const doing = await Order.count({ where: { worker_id: w.id, status: ['dispatched', 'accepted', 'working'] } });
  const done = await Order.count({ where: { worker_id: w.id, status: 'completed' } });
  const pending = await Order.count({ where: { status: 'pending', worker_id: null } });

  // 收入汇总（模型取数 + JS 归并：本月完成单的 price − service_fee，今日再按自然日过滤）
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dayStr = `${dayStart.getFullYear()}-${pad2(dayStart.getMonth() + 1)}-${pad2(dayStart.getDate())}`;

  const incomeRows = await Order.findAll({
    attributes: ['price', 'service_fee', 'completed_at'],
    where: {
      worker_id: w.id,
      status: 'completed',
      completed_at: { [Op.gte]: monthStart },
    },
    raw: true,
  });

  // 以「分」为单位累加避免浮点误差，最终换回元（与原 SQL DECIMAL 求和口径一致）
  let todayCents = 0;
  let monthCents = 0;
  for (const r of incomeRows as unknown as Array<{ price: string | number; service_fee: string | number; completed_at: string | null }>) {
    const incomeCents = Math.round(Number(r.price) * 100) - Math.round(Number(r.service_fee) * 100);
    monthCents += incomeCents;
    if (r.completed_at && String(r.completed_at) >= dayStr) todayCents += incomeCents;
  }

  return {
    doing,
    done,
    pending,
    today_income: todayCents / 100,
    month_income: monthCents / 100,
    rating: Number(w.rating),
    status: w.status,
  };
}
