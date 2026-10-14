/**
 * constants/index.js
 * 全局常量：状态/支付映射、评价标签、入驻选项等
 *  - 纯数据、无依赖、无副作用，供 utils/ 与各页面 require
 *  - 值与原定义一字不差（含注释），仅迁移位置
 */

/* —— 订单状态映射 —— */

/** 订单状态 → 中文 + 颜色 class（与 docs/API.md 状态机一致） */
const STATUS_MAP = {
  pending: { text: '待接单', cls: 'st-pending' },
  dispatched: { text: '已派单', cls: 'st-dispatched' },
  accepted: { text: '已接单', cls: 'st-accepted' },
  working: { text: '服务中', cls: 'st-working' },
  finished: { text: '待确认', cls: 'st-finished' },
  aborted: { text: '中途结束', cls: 'st-aborted' },
  completed: { text: '已完成', cls: 'st-completed' },
  cancelled: { text: '已取消', cls: 'st-cancelled' }
};

/** 订单状态筛选 tab（order-list 使用） */
const STATUS_TABS = [
  { value: '', text: '全部' },
  { value: 'pending', text: '待接单' },
  { value: 'dispatched', text: '已派单' },
  { value: 'accepted', text: '已接单' },
  { value: 'working', text: '服务中' },
  { value: 'finished', text: '待确认' },
  { value: 'aborted', text: '中途结束' },
  { value: 'completed', text: '已完成' },
  { value: 'cancelled', text: '已取消' }
];

/* —— 支付状态映射 —— */

/** 支付状态 → 徽标中文 + 颜色 class（docs/API.md 支付状态枚举），未知返回 null */
const PAY_MAP = {
  unpaid: { text: '待支付', cls: 'warning' },
  paid: { text: '已支付', cls: 'success' },
  refunded: { text: '已退款', cls: 'info' }
};

/* —— 服务类目 —— */

/** 固定追加的「其他 / 自定义」类目项（id = 0，不与接口类目 id 冲突） */
const CUSTOM_CATEGORY = {
  id: 0,
  name: '自定义',
  icon: '📋',
  is_custom: true,
  description: '费用按实际报价，师傅接单前可沟通',
  unit: '',
  min_price: 0
};

/* —— 评价标签 —— */

/** 客户评师傅快捷标签候选（docs/DESIGN-phase2.md §4.1，≤3 个） */
const RATE_TAGS = ['准时到达', '技术专业', '服务态度好', '收费合理', '二次上门'];
/** 师傅回评客户标签候选（docs/DESIGN-phase2.md §4.2，≤3 个） */
const WORKER_RATE_TAGS = ['沟通顺畅', '地址清晰', '守约配合', '需求明确'];

/* —— 师傅入驻选项 —— */

const YEARS_OPTIONS = ['1年以下', '1-3年', '3-5年', '5-10年', '10年以上'];
const YEARS_VALUES = [0, 1, 3, 5, 10];

module.exports = {
  STATUS_MAP,
  STATUS_TABS,
  PAY_MAP,
  CUSTOM_CATEGORY,
  RATE_TAGS,
  WORKER_RATE_TAGS,
  YEARS_OPTIONS,
  YEARS_VALUES
};
