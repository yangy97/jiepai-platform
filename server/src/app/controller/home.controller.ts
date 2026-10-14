/**
 * 首页 / 类目接口（可选鉴权）
 * Sequelize 迁移收尾（docs/changes/006 二阶段收尾）：全部走模型，不再写原生 SQL
 */
import { ok, asyncHandler } from '../../util/express-helper';
import { Op, Order, ServiceCategory, User } from '../../db/models';
import type { CategoryRow } from '../../types';

function mapCategory(r: CategoryRow) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    min_price: Number(r.min_price),
    unit: r.unit,
    description: r.description,
    sort: r.sort,
    status: r.status,
  };
}

export default (router: import('express').Router) => {
  router.get('/home', asyncHandler(async (req, res) => {
    const [cats, pending, done] = await Promise.all([
      ServiceCategory.findAll({ where: { status: 1 }, order: [['sort', 'DESC'], ['id', 'ASC']], raw: true }),
      Order.count({ where: { status: 'pending' } }),
      Order.count({ where: { status: { [Op.in]: ['completed', 'finished', 'working'] } } }),
    ]);
    const categories = (cats as unknown as CategoryRow[]).map(mapCategory);
    ok(res, {
      banners: [
        { id: 1, title: '专业师傅上门', subtitle: '30 分钟极速响应 · 平台担保交易' },
        { id: 2, title: '首单立减 20 元', subtitle: '新用户下单即享优惠，先服务后付款' },
      ],
      categories,
      notice: `当前有 ${pending} 个订单正在招募师傅，累计已完成 ${done} 单服务`,
      stats: { pending, done },
    });
  }));

  router.get('/categories', asyncHandler(async (req, res) => {
    const list = (await ServiceCategory.findAll({
      where: { status: 1 },
      order: [['sort', 'DESC'], ['id', 'ASC']],
      raw: true,
    }) as unknown as CategoryRow[]).map(mapCategory);
    ok(res, { list });
  }));

  // 兼容：根据手机号查客户（运营代客下单用，需要登录）
  router.get('/users/search', asyncHandler(async (req, res) => {
    const { phone } = req.query;
    const user = phone
      ? await User.findOne({
          where: { phone: String(phone) },
          attributes: ['id', 'phone', 'name', 'role'],
          raw: true,
        })
      : null;
    ok(res, { user: user as { id: number; phone: string; name: string; role: string } | null });
  }));
};
