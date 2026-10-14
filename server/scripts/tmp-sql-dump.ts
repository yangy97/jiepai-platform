/** 临时：dump 计划中的模型查询 SQL（跑完即删） */
import { sequelize, Order, OrderLog, User, Worker, Op, literal, fn, col } from '../src/db/models';
import { orderInclude } from '../src/db/order-join';

sequelize.options.logging = (sql: string) => console.log('SQL>', sql.replace(/\s+/g, ' ').trim());

async function main() {
  // 1) adminList findAndCountAll（keyword）
  const kw = '%138%';
  try {
    const r = await Order.findAndCountAll({
      where: { [Op.and]: [{ status: 'pending' }, { [Op.or]: [
        { order_no: { [Op.like]: kw } },
        { '$customer.phone$': { [Op.like]: kw } },
        { '$worker.user.phone$': { [Op.like]: kw } },
      ] }] },
      include: orderInclude(),
      raw: true, nest: true,
      order: [['created_at', 'DESC']],
      limit: 20, offset: 0,
      distinct: true, col: 'id',
    });
    console.log('adminList count=', r.count, 'rows=', r.rows.length, 'firstKeys=', r.rows[0] && Object.keys(r.rows[0]).join(','));
  } catch (e) { console.log('adminList FAIL', e.message); }

  // 2) workerList findAndCountAll（include user + FIELD）
  try {
    const r = await Worker.findAndCountAll({
      where: { [Op.and]: [{ status: 'approved' }, { [Op.or]: [{ real_name: { [Op.like]: kw } }, { '$user.phone$': { [Op.like]: kw } }] }] },
      include: [{ model: User, as: 'user', attributes: ['phone', 'name'], required: true }],
      raw: true, nest: true,
      order: [[literal("FIELD(Worker.status,'pending','approved','rejected','disabled')"), 'ASC'], ['id', 'DESC']],
      limit: 10, offset: 0,
      distinct: true, col: 'id',
    });
    console.log('workerList count=', r.count, 'rows=', r.rows.length, 'first=', JSON.stringify(r.rows[0]).slice(0, 200));
  } catch (e) { console.log('workerList FAIL', e.message); }

  // 3) customerList group 聚合
  try {
    const rows = await User.findAll({
      attributes: ['id', 'phone', 'name', 'avatar', 'rating', 'restricted', 'restricted_reason', 'restricted_until', 'created_at',
        [fn('COUNT', col('customer_orders.id')), 'order_count'],
        [literal("COALESCE(SUM(CASE WHEN customer_orders.status = 'completed' THEN customer_orders.price ELSE 0 END), 0)"), 'total_spent'],
        [literal("COALESCE(SUM(CASE WHEN customer_orders.status = 'completed' THEN 1 ELSE 0 END), 0)"), 'done_count']],
      include: [{ model: Order, as: 'customer_orders', required: false, attributes: [] }],
      where: { role: 'customer', [Op.or]: [{ name: { [Op.like]: kw } }, { phone: { [Op.like]: kw } }] },
      group: [col('User.id')],
      order: [['id', 'DESC']],
      limit: 5, offset: 0,
      subQuery: false,
      raw: true,
    });
    console.log('customerList rows=', rows.length, 'first=', JSON.stringify(rows[0]).slice(0, 300));
  } catch (e) { console.log('customerList FAIL', e.message); }

  // 4) dashboard 订单聚合
  try {
    const [ord] = await Order.findAll({
      attributes: [
        [fn('COUNT', col('Order.id')), 'order_count'],
        [literal("COALESCE(SUM(DATE(created_at) = CURDATE()), 0)"), 'today_count'],
        [literal("COALESCE(SUM(status = 'pending'), 0)"), 'pending_dispatch'],
        [literal("COALESCE(SUM(status IN ('dispatched','accepted','working')), 0)"), 'doing'],
        [literal("COALESCE(SUM(CASE WHEN status = 'completed' THEN price - service_fee ELSE 0 END), 0)"), 'done_amount'],
        [literal("COALESCE(AVG(rating), 5)"), 'avg_rating'],
      ],
      raw: true,
    });
    console.log('dash orders=', JSON.stringify(ord));
    const [wk] = await Worker.findAll({
      attributes: [[fn('COUNT', col('Worker.id')), 'worker_count'], [literal("COALESCE(SUM(status = 'approved'), 0)"), 'approved_worker_count']],
      raw: true,
    });
    console.log('dash workers=', JSON.stringify(wk));
    const cust = await User.count({ where: { role: 'customer' } });
    console.log('dash customers=', cust);
  } catch (e) { console.log('dash FAIL', e.message); }

  // 5) trend group
  try {
    const rows = await Order.findAll({
      attributes: [[literal("DATE_FORMAT(MIN(created_at), '%m-%d')"), 'date'], [fn('COUNT', col('Order.id')), 'count']],
      where: { created_at: { [Op.gte]: literal('DATE_SUB(CURDATE(), INTERVAL 6 DAY)') } },
      group: [literal("DATE_FORMAT(created_at, '%Y-%m-%d')")],
      order: [[literal('MIN(created_at)'), 'ASC']],
      raw: true,
    });
    console.log('trend=', JSON.stringify(rows));
  } catch (e) { console.log('trend FAIL', e.message); }

  // 6) status 分布
  try {
    const rows = await Order.findAll({ attributes: ['status', [fn('COUNT', col('Order.id')), 'count']], group: ['status'], raw: true });
    console.log('status_dist=', JSON.stringify(rows));
  } catch (e) { console.log('status FAIL', e.message); }

  // 7) workerDetail counts
  try {
    const rows = await Order.findAll({
      attributes: [
        [literal("SUM(status IN ('dispatched','accepted','working'))"), 'doing'],
        [literal("SUM(status = 'completed')"), 'done'],
        [literal("SUM(status = 'cancelled')"), 'cancelled'],
      ],
      where: { worker_id: 1 }, raw: true,
    });
    console.log('workerCounts=', JSON.stringify(rows));
  } catch (e) { console.log('workerCounts FAIL', e.message); }

  // 8) detail logs include operator
  try {
    const rows = (await sequelize.query('SELECT id FROM orders LIMIT 1', { type: 'SELECT' } as any)) as any[];
    const oid = rows[0]?.id;
    const logs = await OrderLog.findAll({
      where: { order_id: oid },
      include: [{ model: User, as: 'operator', attributes: ['name'], required: false }],
      order: [['created_at', 'ASC'], ['id', 'ASC']],
      raw: true, nest: true,
    });
    console.log('logs=', JSON.stringify(logs.slice(0, 2)));
  } catch (e) { console.log('logs FAIL', e.message); }

  await sequelize.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
