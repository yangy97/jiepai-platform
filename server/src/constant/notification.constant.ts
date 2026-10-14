/**
 * 站内通知领域常量（阶段二 · docs/DESIGN-phase2.md §3）
 */

/** 通知类型（notifications.type；值与历史落库数据保持一致） */
export const NOTIFICATION_TYPE = {
  /** 新订单派单（通知师傅） */
  dispatch: 'dispatch',
  /** 师傅已接单（通知客户） */
  accept: 'accept',
  /** 上门时间提醒（预约前 30 分钟，通知师傅） */
  start_remind: 'start_remind',
  /** 开工已超时（超预约时间 30 分钟，通知师傅+客户） */
  start_timeout: 'start_timeout',
  /** 订单待确认（师傅完工，通知客户） */
  finish: 'finish',
  /** 结算已入账（客户确认，通知师傅） */
  confirm: 'confirm',
  /** 退款到账通知（通知客户） */
  refund: 'refund',
  /** 收到评价（通知被评方） */
  rate: 'rate',
  /** 账号受限（低分惩罚，通知被限人） */
  restrict: 'restrict',
  /** 订单中途结束（通知双方） */
  abort: 'abort',
  /** 订单取消（通知双方） */
  cancel: 'cancel',
} as const;

/**
 * 订阅消息模板字段 key（通知 type → 字段列表）
 * 每个模板的字段序号/类型各异（thing1/time2/amount3…），以 mp 后台「订阅消息」模板详情为准调整；
 * 值取 [title, content]，按微信 thing 字段限制截断 20 字。
 */
export const SUBSCRIBE_TEMPLATE_FIELDS: Record<string, string[]> = {
  dispatch: ['thing1', 'thing2'],
  finish: ['thing1', 'thing2'],
  refund: ['thing1', 'thing2'],
  cancel: ['thing1', 'thing2'],
  start_remind: ['thing1', 'thing2'],
};

/** 通知类型 → 中文说明（供注释/未来展示用） */
export const NOTIFY_TYPE_TEXT: Record<string, string> = {
  dispatch: '新订单派单',
  accept: '师傅已接单',
  start_remind: '上门时间提醒',
  start_timeout: '开工已超时',
  finish: '订单待确认',
  confirm: '结算已入账',
  refund: '退款到账',
  rate: '收到评价',
  restrict: '账号受限',
  abort: '订单中途结束',
  cancel: '订单取消',
};
