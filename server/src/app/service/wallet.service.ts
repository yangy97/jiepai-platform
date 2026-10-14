/**
 * 钱包服务
 * Sequelize 迁移：本人钱包/流水走 Wallet/WalletLog 模型；
 * 管理端师傅钱包列表 / 全平台流水（跨表带出用户名与订单号）走模型 include。
 */
import { Order, User, Wallet, WalletLog, Worker, Op } from '../../db/models';
import { WALLET_TYPE_TEXT } from '../../constant/wallet.constant';
import { paging } from './order.service';
import type { WalletLogRow } from '../../types';

/** 钱包流水 → 接口返回结构 */
export function fmtLog(r: WalletLogRow) {
  return {
    id: r.id,
    order_id: r.order_id,
    type: r.type,
    type_text: WALLET_TYPE_TEXT[r.type] || r.type,
    amount: Number(r.amount),
    balance_after: Number(r.balance_after),
    remark: r.remark,
    created_at: r.created_at,
  };
}

export async function wallet(userId: number) {
  const w = await Wallet.findOne({ where: { user_id: userId } });
  if (!w) return { balance: 0, income: 0, withdrawn: 0 };
  return { balance: Number(w.balance), income: Number(w.income), withdrawn: Number(w.withdrawn) };
}

export async function logs(userId: number, params: Record<string, any>) {
  const { p, size, offset } = paging(params);
  const { rows, count } = await WalletLog.findAndCountAll({
    where: { user_id: userId },
    order: [['id', 'DESC']],
    limit: size,
    offset,
  });
  return { list: rows.map((r) => fmtLog(r.get({ plain: true }) as unknown as WalletLogRow)), total: count, page: p, page_size: size };
}

/** 管理端：师傅钱包列表（迁移前：wallets JOIN users LEFT JOIN workers + ORDER BY balance DESC） */
export async function adminWallets(params: Record<string, any>) {
  const { p, size, offset } = paging(params);
  const { keyword } = params;
  let where = {};
  if (keyword) {
    const kw = `%${keyword}%`;
    where = {
      [Op.or]: [
        { '$w_user.name$': { [Op.like]: kw } },
        { '$w_user.phone$': { [Op.like]: kw } },
        { '$w_worker.real_name$': { [Op.like]: kw } },
      ],
    };
  }
  const { rows, count } = await Wallet.findAndCountAll({
    where,
    include: [
      { model: User, as: 'w_user', attributes: ['name', 'phone'] },
      { model: Worker, as: 'w_worker', attributes: ['real_name'], required: false },
    ],
    order: [['balance', 'DESC']],
    limit: size,
    offset,
    raw: true,
    nest: true, // raw 行内 include 嵌套为对象（否则键为 'w_user.name' 扁平串）
  });
  return {
    list: rows.map((r: any) => ({
      user_id: r.user_id,
      name: r.w_worker?.real_name || r.w_user?.name,
      phone: r.w_user?.phone,
      balance: Number(r.balance),
      income: Number(r.income),
      withdrawn: Number(r.withdrawn),
      updated_at: r.updated_at,
    })),
    total: count,
    page: p,
    page_size: size,
  };
}

/** 管理端：全平台流水（迁移前：wallet_logs JOIN users LEFT JOIN orders + ORDER BY wl.id DESC） */
export async function adminLogs(params: Record<string, any>) {
  const { p, size, offset } = paging(params);
  const { user_id, type } = params;
  const where: Record<string, any> = {};
  if (user_id) where.user_id = user_id;
  if (type) where.type = type;
  const { rows, count } = await WalletLog.findAndCountAll({
    where,
    include: [
      { model: User, as: 'l_user', attributes: ['name', 'phone'] },
      { model: Order, as: 'l_order', attributes: ['order_no'], required: false },
    ],
    order: [['id', 'DESC']],
    limit: size,
    offset,
    raw: true,
    nest: true, // raw 行内 include 嵌套为对象（否则键为 'l_user.name' 扁平串）
  });
  return {
    list: rows.map((r: any) => ({
      ...fmtLog(r as WalletLogRow),
      user_id: r.user_id,
      user_name: r.l_user?.name,
      user_phone: r.l_user?.phone,
      order_no: r.l_order?.order_no || '',
    })),
    total: count,
    page: p,
    page_size: size,
  };
}
