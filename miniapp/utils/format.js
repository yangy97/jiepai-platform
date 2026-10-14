/**
 * utils/format.js
 * 职责：时间格式化、订单状态映射（中文 + 颜色 class）、金额格式化等纯工具函数。
 */

const { STATUS_MAP, PAY_MAP } = require('../constants/index');

/** 取订单状态的中文与样式类 */
function statusInfo(status) {
  return STATUS_MAP[status] || { text: status || '未知', cls: 'st-cancelled' };
}

/** 取支付状态的徽标信息（未知或旧版服务端无该字段时返回 null，展示侧兜底隐藏） */
function payStatusInfo(status) {
  return PAY_MAP[status] || null;
}

/** Date 或 'YYYY-MM-DD hh:mm:ss' → 'YYYY-MM-DD hh:mm' */
function formatTime(input) {
  if (!input) return '';
  let d;
  if (input instanceof Date) {
    d = input;
  } else {
    // 兼容 "2026-10-12 09:00:00" 与 ISO 格式
    const s = String(input).replace(/-/g, '/').replace('T', ' ').replace(/\.\d+Z?$/, '');
    d = new Date(s);
    if (isNaN(d.getTime())) return String(input);
  }
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  );
}

/** 仅日期 */
function formatDate(input) {
  const s = formatTime(input);
  return s ? s.slice(0, 10) : '';
}

/** 金额：保留两位小数 */
function money(n) {
  const v = Number(n || 0);
  return v.toFixed(2);
}

/** 钱包流水 type → 中文 */
function walletTypeText(type) {
  if (type === 'income') return '收入';
  if (type === 'withdraw') return '提现';
  if (type === 'refund') return '退款';
  return type || '';
}

/** 评价标签（rate_tags / worker_rate_tags，逗号分隔字符串或数组）→ 字符串数组 */
function splitTags(s) {
  if (!s) return [];
  if (Array.isArray(s)) {
    return s.map((t) => String(t).trim()).filter((t) => t !== '');
  }
  return String(s)
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

module.exports = {
  statusInfo,
  payStatusInfo,
  formatTime,
  formatDate,
  money,
  walletTypeText,
  splitTags
};
