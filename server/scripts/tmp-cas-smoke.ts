/**
 * 临时烟测：Model.update affectedCount 语义（跑完即删）
 * 1) no-op UPDATE（值=现值、WHERE 命中）→ 期望 affectedCount=1（CLIENT_FOUND_ROWS=匹配行数）
 * 2) WHERE 未命中 → 期望 0
 * 3) 事务内同一订单连续两次 CAS 推进（均 from=['pending']）→ 第一次 1、第二次 0，事务回滚不落库
 * 4) literal 更新（GREATEST）与 literal 排序（FIELD）语法/执行验证
 */
import { sequelize, Order, Worker, Op, literal } from '../src/db/models';

async function main() {
  await sequelize.authenticate();
  const order = (await Order.findOne({ where: { status: 'pending' }, order: [['id', 'ASC']], raw: true })) as any;
  if (!order) throw new Error('no pending order');
  const worker = (await Worker.findOne({ raw: true })) as any;

  await sequelize.transaction(async (t) => {
    const [n1] = await Order.update(
      { cancel_reason: order.cancel_reason ?? '' }, // no-op：与现值相同
      { where: { id: order.id, status: { [Op.in]: ['pending', 'dispatched'] } }, transaction: t },
    );
    const [n2] = await Order.update(
      { cancel_reason: 'x' },
      { where: { id: order.id, status: { [Op.in]: ['completed'] } }, transaction: t }, // 未命中
    );
    const [c1] = await Order.update(
      { status: 'dispatched', dispatch_at: new Date() },
      { where: { id: order.id, status: { [Op.in]: ['pending'] } }, transaction: t },
    );
    const [c2] = await Order.update(
      { status: 'accepted' },
      { where: { id: order.id, status: { [Op.in]: ['pending'] } }, transaction: t }, // 已被上一步改走 → 0
    );
    const [g] = await Worker.update(
      { order_count: literal('GREATEST(order_count - 1, 0)') } as any,
      { where: { id: worker.id }, transaction: t },
    );
    console.log(JSON.stringify({ noop_hit: n1, miss: n2, first_cas: c1, second_cas: c2, greatest: g }));
    throw new Error('__rollback__');
  }).catch((e) => {
    if (e.message !== '__rollback__') throw e;
    console.log('rolled back ok');
  });

  // FIELD 排序（只读）
  const rows = (await Order.findAll({
    attributes: ['id', 'status'],
    order: [[literal("FIELD(status,'pending','dispatched','accepted','working','finished','aborted','completed','cancelled')"), 'ASC']],
    limit: 5,
    raw: true,
  })) as any[];
  console.log('FIELD ok, first statuses:', rows.map((r) => r.status).join(','));

  const after = (await Order.findOne({ where: { id: order.id }, raw: true })) as any;
  const wAfter = (await Worker.findOne({ where: { id: worker.id }, raw: true })) as any;
  console.log('rollback verified:', after.status === order.status, wAfter.order_count === worker.order_count);
  await sequelize.close();
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
