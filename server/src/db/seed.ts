/**
 * 种子数据：演示账号 / 服务类目 / 师傅档案 / 订单（含状态流水）/ 钱包
 * 用法：npx tsx src/db/seed.ts [--force]   （--force 会清空业务表重新灌入）
 */
import bcrypt from 'bcryptjs';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from './pool';
import { genOrderNo } from '../util/orderNo';

const force = process.argv.includes('--force');

/** 类目：name, icon, min_price, unit, description, sort */
const CATEGORIES: Array<[string, string, number, string, string, number]> = [
  ['家电清洗', '🧹', 89, '次', '油烟机、空调、洗衣机深度清洗消毒', 98],
  ['管道疏通', '🔧', 79, '次', '马桶、地漏、下水道专业疏通', 95],
  ['家具安装', '🪑', 69, '件', '衣柜、床、橱柜上门安装拆卸', 90],
  ['灯具电路', '💡', 79, '次', '灯具安装、开关插座更换、线路检修', 88],
  ['保洁保养', '🧽', 45, '小时', '日常保洁、深度开荒、玻璃清洗', 85],
  ['墙面修补', '🎨', 120, '㎡', '刮腻子、补漆、瓷砖空鼓修复', 70],
  ['开锁换锁', '🔑', 100, '次', '24小时开锁、换芯、指纹锁安装', 80],
  ['搬运重物', '📦', 150, '次', '家具搬运、同城拉货、上门拆装', 65],
  // —— 第二批：更多上门服务类型 ——
  ['家电维修', '🔩', 120, '次', '冰箱、洗衣机、热水器等故障检修', 76],
  ['水电维修', '⚡', 90, '次', '漏水跳闸、插座龙头、水管改造', 74],
  ['空调移机', '❄️', 160, '台', '空调加氟、拆装移机、清洗保养', 72],
  ['消杀除螨', '🧴', 199, '次', '甲醛治理、蟑螂蚊虫消杀、床垫除螨', 68],
  ['门窗五金', '🚪', 110, '次', '纱窗更换、门窗打胶、合页锁体维修', 62],
  ['母婴家电', '🍼', 89, '次', '婴儿床安装、推车消毒、安全座椅安装', 58],
  ['宠物上门', '🐾', 80, '次', '上门喂猫遛狗、铲屎、临时照看', 55],
  ['收纳整理', '🧳', 150, '小时', '衣橱整理、搬家复原、全屋收纳规划', 52],
];

/** 客户：phone, name */
const CUSTOMERS: Array<[string, string]> = [
  ['13800000001', '王小美'],
  ['13800000002', '陈先生'],
  ['13800000003', '刘女士'],
];

/** 师傅：phone, name, region, skills(类目下标), years, rating, status, bio */
const WORKERS: Array<[string, string, string, number[], number, number, string, string]> = [
  ['13800000011', '李建国', '福田区 / 南山区', [0, 4], 8, 4.9, 'approved', '8年家政维修经验，持证上岗，服务超 2000 单，客户好评率 99%。'],
  ['13800000012', '赵师傅', '宝安区 / 龙华区', [1, 3, 6], 6, 4.8, 'approved', '水电维修专业户，随叫随到，明码标价不加价。'],
  ['13800000013', '孙志强', '罗湖区 / 福田区', [2, 7], 3, 4.7, 'pending', '家具安装拆装五年经验，自带全套工具。'],
  ['13800000014', '周敏', '南山区', [4, 5], 4, 4.9, 'approved', '开荒保洁团队负责人，注重细节与环保耗材。'],
];

/** 地址：address, lng, lat */
const ADDRESSES: Array<[string, number, number]> = [
  ['深圳市福田区梅林路 168 号 阳光四季花园 3 栋 1201', 114.0578, 22.6288],
  ['深圳市南山区科技园科苑路 15 号 海岸大厦 B 座 808', 113.9455, 22.5405],
  ['深圳市宝安区新安街道宝源路 88 号 花样年小区 5-203', 113.8867, 22.5781],
  ['深圳市罗湖区深南东路 5016 号 京基一百 A 座 2206', 114.1058, 22.5465],
  ['深圳市龙华区民治街道星河 WORLD 二期 6 栋 1802', 114.0320, 22.6100],
];

/** 订单模板：[类目下标, 标题, 描述, 客户下标, 师傅下标(可空), 状态, 预算, 结算价, 距今小时] */
const ORDER_TPL: Array<[number, string, string, number, number | null, string, number, number, number]> = [
  [0, '油烟机深度清洗', '老板牌抽油烟机，三年未清洗，希望拆洗风轮。', 0, 0, 'completed', 120, 138, 60],
  [1, '马桶堵塞疏通', '主卫马桶冲不下去，有异物堵塞，急。', 1, 1, 'completed', 90, 95, 46],
  [4, '三居室日常保洁', '120 平方，每周一次，需自带工具。', 2, 3, 'working', 180, 0, 20],
  [2, '定制衣柜安装', '新买的三门衣柜，需要上门组装，配件齐全。', 0, 2, 'accepted', 260, 0, 8],
  [3, '客厅吸顶灯更换', '灯具已买好，需要拆旧装新并接好驱动。', 1, null, 'pending', 100, 0, 5],
  [6, '入户门锁芯更换', '钥匙丢了想换 C 级锁芯，需要带样品上门。', 2, null, 'pending', 180, 0, 3],
  [5, '儿童房补漆', '墙面有一块 2 ㎡ 脱皮，需要刮腻子补漆调色。', 0, null, 'pending', 240, 0, 2],
  [7, '沙发搬运上楼', '三人位沙发从 1 楼搬到 6 楼，无电梯。', 1, 1, 'dispatched', 200, 0, 1.5],
  [0, '空调深度清洗', '两台挂机空调，使用年限 5 年，需拆洗。', 2, 0, 'finished', 240, 240, 1],
  [4, '厨房油污深度清洁', '长期未清理的重油污，需高温蒸汽机。', 0, 3, 'finished', 160, 168, 0.8],
  [1, '地漏反味处理', '两个地漏反味，希望彻底解决。', 1, null, 'pending', 80, 0, 0.5],
  [3, '更换厨房开关面板', '五个开关面板老化，需要全部更换。', 2, null, 'pending', 120, 0, 0.3],
  [2, '儿童学习桌安装', '带书架学习桌，孔位较多。', 0, 2, 'accepted', 150, 0, 6],
  [6, '办公室开锁', '公司玻璃门钥匙锁在屋里了。', 1, 1, 'completed', 150, 150, 72],
  [4, '退租深度保洁', '退租前全屋深度保洁，重点厨卫。', 2, 3, 'completed', 420, 450, 68],
  [7, '冰箱洗衣机搬运', '两台家电从 3 楼搬到货车上。', 0, 0, 'cancelled', 160, 0, 30],
];

const STATUS_TIME: Record<string, string[]> = {
  dispatched: ['dispatch_at'],
  accepted: ['dispatch_at', 'accepted_at'],
  working: ['dispatch_at', 'accepted_at', 'started_at'],
  finished: ['dispatch_at', 'accepted_at', 'started_at', 'finished_at'],
  completed: ['dispatch_at', 'accepted_at', 'started_at', 'finished_at', 'completed_at'],
  cancelled: ['cancelled_at'],
};

function dt(hoursAgo: number): string {
  const d = new Date(Date.now() - hoursAgo * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 幂等补齐服务类目：按 name 去重，缺哪个补哪个（用于已有环境升级） */
async function ensureCategories(conn: PoolConnection): Promise<number> {
  const [exist] = await conn.query<RowDataPacket[]>('SELECT name FROM service_categories');
  const has = new Set(exist.map((r) => r.name as string));
  let added = 0;
  for (const [name, icon, minPrice, unit, desc, sort] of CATEGORIES) {
    if (has.has(name)) continue;
    await conn.query(
      'INSERT INTO service_categories (name, icon, min_price, unit, description, sort, status) VALUES (?,?,?,?,?,?,1)',
      [name, icon, minPrice, unit, desc, sort],
    );
    added += 1;
  }
  return added;
}

/** 返回与 CATEGORIES 下标对齐的类目 id 列表 */
async function categoryIdsByIndex(conn: PoolConnection): Promise<any[]> {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT id, name FROM service_categories');
  const map = new Map<string, number>(rows.map((r) => [r.name as string, r.id as number]));
  return CATEGORIES.map((c) => map.get(c[0]));
}

/**
 * 阶段二演示单：时薪（hourly）订单，状态 working（已开工 40 分钟）
 * 用于演示「中途退出按半小时向上取整计费」（40 分钟 = 1.0h × ¥60）
 * 老种子单（ORDER_TPL）全部走列默认值：refund_policy='flexible'、billing_type='fixed'
 * 幂等：按标题去重，存在则跳过（不影响 api-test 断言）
 */
const HOURLY_TITLE = '小时工保洁（时薪演示单）';
async function ensureHourlyDemo(conn: PoolConnection): Promise<any> {
  const [exists] = await conn.query<RowDataPacket[]>('SELECT id FROM orders WHERE title = ? LIMIT 1', [HOURLY_TITLE]);
  if (exists.length) return null;

  // 关联账号按手机号查找（演示库固定手机号；找不到则跳过，不阻断种子）
  const [[cust]] = await conn.query<RowDataPacket[]>('SELECT id FROM users WHERE phone = ? LIMIT 1', ['13800000003']);
  const [[wrow]] = await conn.query<RowDataPacket[]>(
    `SELECT w.id, w.user_id FROM workers w JOIN users u ON u.id = w.user_id WHERE u.phone = ? AND w.status = 'approved' LIMIT 1`,
    ['13800000012'],
  );
  const [[cat]] = await conn.query<RowDataPacket[]>('SELECT id FROM service_categories WHERE name = ? LIMIT 1', ['保洁保养']);
  if (!cust || !wrow || !cat) {
    console.log('[seed] 跳过 hourly 演示单（演示账号/类目缺失）');
    return null;
  }

  const p = (n: number) => String(n).padStart(2, '0');
  const dtv = (msAgo: number) => {
    const d = new Date(Date.now() - msAgo);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const H = 3600 * 1000;
  const created = dtv(3 * H);
  const startedAt = dtv((40 / 60) * H); // 已服务 40 分钟 → abort 时按 1.0h 计费

  const [r] = await conn.query<ResultSetHeader>(
    `INSERT INTO orders (order_no, customer_id, worker_id, category_id, title, description, address, lng, lat,
       expect_at, budget, price, service_fee, status, source, pay_status, paid_at,
       refund_policy, billing_type, hourly_price,
       dispatch_at, accepted_at, started_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'working', 'customer', 'paid', ?,
       'flexible', 'hourly', 60, ?, ?, ?, ?)`,
    [
      genOrderNo(), cust.id, wrow.id, cat.id, HOURLY_TITLE,
      '时薪计费演示单：¥60/h，半小时向上取整；服务中途可按已服务时长结算退款。',
      ADDRESSES[1][0], ADDRESSES[1][1], ADDRESSES[1][2],
      dtv(1 * H), // expect_at：1 小时前
      240, 0, 0, created, // 预算 240（= 4h 上限），price/service_fee=0，已支付
      dtv(2.8 * H), dtv(2.6 * H), startedAt, created,
    ],
  );
  const oid = r.insertId;
  const addLog = (action: string, from: string, to: string, opId: number | null, opRole: string, content: string, hoursAgo: number) =>
    conn.query<ResultSetHeader>(
      'INSERT INTO order_logs (order_id, action, from_status, to_status, operator_id, operator_role, content, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [oid, action, from, to, opId, opRole, content, dtv(hoursAgo)],
    );
  await addLog('create', '', 'pending', cust.id, 'customer', '客户提交需求', 3 * H);
  await addLog('pay', 'unpaid', 'paid', cust.id, 'customer', '模拟支付成功（线下已付）', 3 * H);
  await addLog('dispatch', 'pending', 'dispatched', null, 'admin', `运营指派给「${wrow.id}」`, 2.8 * H);
  await addLog('accept', 'dispatched', 'accepted', wrow.user_id, 'worker', '师傅确认接单', 2.6 * H);
  await addLog('start', 'accepted', 'working', wrow.user_id, 'worker', '师傅已上门开工', (40 / 60) * H);
  await conn.query<ResultSetHeader>('UPDATE workers SET order_count = order_count + 1 WHERE id = ?', [wrow.id]);
  console.log(`[seed] 已补入 hourly 演示单：${HOURLY_TITLE}（¥60/h，working）`);
  return oid;
}

async function main() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [[{ c }]] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM users');
    if (c > 0 && !force) {
      const added = await ensureCategories(conn);
      await ensureHourlyDemo(conn); // 阶段二：补 hourly 演示单（幂等）
      console.log(`[seed] 已有数据，跳过全量初始化；本次补入服务类目 ${added} 个（共 ${CATEGORIES.length} 个内置类型）`);
      return;
    }
    if (force) {
      await conn.query('SET FOREIGN_KEY_CHECKS=0');
      for (const t of ['wallet_logs', 'wallets', 'order_logs', 'orders', 'workers', 'service_categories', 'users']) {
        await conn.query(`TRUNCATE TABLE \`${t}\``);
      }
      await conn.query('SET FOREIGN_KEY_CHECKS=1');
      console.log('[seed] 已清空业务表');
    }

    await conn.beginTransaction();

    // ---------- 账号 ----------
    const hash = (pwd: string) => bcrypt.hashSync(pwd, 10);
    const insertUser = async (phone: string, name: string, role: string, pwd: string) => {
      const [r] = await conn.query<ResultSetHeader>(
        'INSERT INTO users (phone, password, name, avatar, role) VALUES (?,?,?,?,?)',
        [phone, hash(pwd), name, '', role],
      );
      return r.insertId;
    };

    const adminId = await insertUser('13900000000', '运营 · 小张', 'admin', 'admin123');
    const customerIds: number[] = [];
    for (const [phone, name] of CUSTOMERS) {
      customerIds.push(await insertUser(phone, name, 'customer', '123456'));
    }
    const workerIds: number[] = [];
    const workerUserIds: number[] = [];
    for (const [phone, name] of WORKERS) {
      const uid = await insertUser(phone, name, 'worker', '123456');
      workerUserIds.push(uid);
      workerIds.push(0); // 占位，稍后按插入顺序回填
    }

    // ---------- 类目（幂等：只补缺失的） ----------
    await ensureCategories(conn);
    const categoryIds = await categoryIdsByIndex(conn);

    // ---------- 师傅档案 ----------
    for (let i = 0; i < WORKERS.length; i++) {
      const [, name, region, skills, years, rating, status, bio] = WORKERS[i];
      const skillsCsv = skills.map((s) => categoryIds[s]).join(',');
      const [r] = await conn.query<ResultSetHeader>(
        `INSERT INTO workers (user_id, real_name, id_card, region, skills, years, bio, rating, order_count, done_count, status, audited_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, ${status === 'pending' ? 'NULL' : '?'})`,
        status === 'pending'
          ? [workerUserIds[i], name, `440301199${String(1000000 + i)}`, region, skillsCsv, years, bio, rating, 0, 0, status]
          : [workerUserIds[i], name, `440301199${String(1000000 + i)}`, region, skillsCsv, years, bio, rating, 0, 0, status, dt(24 * 30)],
      );
      workerIds[i] = r.insertId;
      await conn.query<ResultSetHeader>('INSERT INTO wallets (user_id) VALUES (?)', [workerUserIds[i]]);
    }

    // ---------- 订单 ----------
    const completedIncome: Record<string, number> = {}; // workerUserId -> 累计入账
    const addLog = (orderId: number, action: string, from: string, to: string, opId: number | null, opRole: string, content: string, hoursAgo: number) =>
      conn.query<ResultSetHeader>(
        'INSERT INTO order_logs (order_id, action, from_status, to_status, operator_id, operator_role, content, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [orderId, action, from, to, opId, opRole, content, dt(hoursAgo)],
      );

    for (let i = 0; i < ORDER_TPL.length; i++) {
      const [catIdx, title, desc, custIdx, workerIdx, status, budget, price, hoursAgo] = ORDER_TPL[i];
      const addr = ADDRESSES[i % ADDRESSES.length];
      const workerId = workerIdx === null ? null : workerIds[workerIdx];
      const fee = price > 0 ? Math.round(price * 0.1 * 100) / 100 : 0;
      const times = STATUS_TIME[status] || [];
      const timeVal: Record<string, string | null> = {};
      ['dispatch_at', 'accepted_at', 'started_at', 'finished_at', 'completed_at', 'cancelled_at'].forEach((k) => {
        timeVal[k] = null;
      });
      // 时间点由近及远推进
      times.forEach((k, idx) => {
        timeVal[k] = dt(hoursAgo - (times.length - 1 - idx) * 2);
      });
      if (status === 'cancelled') timeVal.cancel_reason = '客户临时有事，取消预约';

      const [r] = await conn.query<ResultSetHeader>(
        `INSERT INTO orders (order_no, customer_id, worker_id, category_id, title, description, address, lng, lat,
           expect_at, budget, price, service_fee, status, source, cancel_reason, pay_status, paid_at,
           dispatch_at, accepted_at, started_at, finished_at, completed_at, cancelled_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          genOrderNo(), customerIds[custIdx], workerId, categoryIds[catIdx], title, desc, addr[0], addr[1], addr[2],
          dt(hoursAgo - 6), budget, price, fee, status, i % 5 === 0 ? 'admin' : 'customer', timeVal.cancel_reason || '',
          // 种子订单模拟「线下已付」：全部已支付，支付时间 = 下单时间
          'paid', dt(hoursAgo),
          timeVal.dispatch_at, timeVal.accepted_at, timeVal.started_at, timeVal.finished_at, timeVal.completed_at, timeVal.cancelled_at,
          dt(hoursAgo),
        ],
      );
      const oid = r.insertId;

      await addLog(oid, 'create', '', 'pending', customerIds[custIdx], 'customer', '客户提交需求', hoursAgo);
      await addLog(oid, 'pay', 'unpaid', 'paid', customerIds[custIdx], 'customer', '模拟支付成功（线下已付）', hoursAgo);
      if (times.includes('dispatch_at')) {
        await addLog(oid, 'dispatch', 'pending', 'dispatched', adminId, 'admin', `运营指派给「${WORKERS[workerIdx!][1]}」`, hoursAgo - (times.length - 1 - times.indexOf('dispatch_at')) * 2);
      }
      if (times.includes('accepted_at')) {
        await addLog(oid, 'accept', 'dispatched', 'accepted', workerUserIds[workerIdx!], 'worker', '师傅确认接单', hoursAgo - (times.length - 1 - times.indexOf('accepted_at')) * 2);
      }
      if (times.includes('started_at')) {
        await addLog(oid, 'start', 'accepted', 'working', workerUserIds[workerIdx!], 'worker', '师傅已上门开工', hoursAgo - (times.length - 1 - times.indexOf('started_at')) * 2);
      }
      if (times.includes('finished_at')) {
        await addLog(oid, 'finish', 'working', 'finished', workerUserIds[workerIdx!], 'worker', `师傅提交完工，结算 ¥${price}`, hoursAgo - (times.length - 1 - times.indexOf('finished_at')) * 2);
      }
      if (times.includes('completed_at')) {
        await addLog(oid, 'confirm', 'finished', 'completed', customerIds[custIdx], 'customer', '客户确认完成，已结算', hoursAgo - (times.length - 1 - times.indexOf('completed_at')) * 2);
        // 钱包入账
        const income = Math.round((price - fee) * 100) / 100;
        const uw = workerUserIds[workerIdx!];
        completedIncome[uw] = (completedIncome[uw] || 0) + income;
        await conn.query<ResultSetHeader>('UPDATE workers SET done_count = done_count + 1, order_count = order_count + 1 WHERE id = ?', [workerId]);
      } else if (workerId && status !== 'cancelled') {
        await conn.query<ResultSetHeader>('UPDATE workers SET order_count = order_count + 1 WHERE id = ?', [workerId]);
      }
      if (status === 'cancelled') {
        await addLog(oid, 'cancel', 'pending', 'cancelled', customerIds[custIdx], 'customer', timeVal.cancel_reason || '订单已取消', hoursAgo);
      }
    }

    // 汇总钱包
    for (const uw of Object.keys(completedIncome)) {
      const income = completedIncome[uw];
      await conn.query<ResultSetHeader>('UPDATE wallets SET balance = balance + ?, income = income + ? WHERE user_id = ?', [income, income, uw]);
      const [[w]] = await conn.query<RowDataPacket[]>('SELECT balance FROM wallets WHERE user_id = ?', [uw]);
      await conn.query<ResultSetHeader>(
        'INSERT INTO wallet_logs (user_id, type, amount, balance_after, remark, created_at) VALUES (?,?,?,?,?,?)',
        [uw, 'income', income, w.balance, '订单完成结算入账', dt(24)],
      );
    }

    // 阶段二：补 1 条 hourly 演示单（幂等，已有则跳过）
    await ensureHourlyDemo(conn);

    await conn.commit();
    console.log('[seed] 种子数据写入完成：', {
      admin: '13900000000 / admin123',
      customers: CUSTOMERS.map((c) => c[0]).join(', '),
      workers: WORKERS.map((w) => w[0]).join(', '),
      orders: ORDER_TPL.length,
      categories: CATEGORIES.length,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[seed] 失败：', err);
  process.exit(1);
});
