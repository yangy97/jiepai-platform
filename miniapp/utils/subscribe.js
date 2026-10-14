/**
 * utils/subscribe.js
 * 微信订阅消息授权引导工具（docs/changes/008）
 *  - 一次性订阅：每授权 1 次 = 每个模板可推 1 条；requestSubscribeMessage 必须由用户点击事件触发
 *    （微信平台硬约束，页面加载/onShow 里自动弹会直接报错），本模块只提供显式入口封装
 *  - getSubscribeStatus() 静默查询订阅总开关（wx.getSetting withSubscriptions，无需点击）
 *  - 授权结果与弹窗频控写 storage（key 前缀 jp_sub_）
 */
const { SUBSCRIBE_TMPL_IDS } = require('../config');

const STORE_ACCEPTED = 'jp_sub_accepted';        // 已成功授权过（横幅隐藏）
const STORE_PREFIX_GUIDE = 'jp_sub_guide_';      // 说明弹窗频控：jp_sub_guide_<node> = 上次弹出时间戳
const GUIDE_INTERVAL_MS = 7 * 24 * 3600 * 1000;  // 每节点 7 天最多弹 1 次

/** 是否配置了真实模板 ID（空 = 演示模式，不弹系统授权窗） */
function hasTemplateIds() {
  return Array.isArray(SUBSCRIBE_TMPL_IDS) && SUBSCRIBE_TMPL_IDS.length > 0;
}

/**
 * 授权弹窗（必须在用户 tap 回调里调用；未配置模板 ID / 失败一律静默 resolve）
 * @returns Promise<Object> res[模板ID] === 'accept' 即该模板本次授权成功
 */
function requestSubscribe() {
  if (!hasTemplateIds()) return Promise.resolve({ skipped: 'no_template' });
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: SUBSCRIBE_TMPL_IDS,
      success: (res) => resolve(res),
      fail: (err) => {
        console.warn('[subscribe] 授权失败（已忽略）', err);
        resolve({ skipped: true });
      }
    });
  });
}

/**
 * 静默查询订阅总开关（不需要用户点击）
 * @returns Promise<'on'|'off'> 'off' = 用户在微信设置里关掉了订阅消息总开关（需引导 wx.openSetting）
 */
function getSubscribeStatus() {
  return new Promise((resolve) => {
    if (!wx.getSetting) return resolve('on');
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const s = (res && res.subscriptionsSetting) || {};
        resolve(s.mainSwitch === false ? 'off' : 'on');
      },
      fail: () => resolve('on') // 查询失败按未知（当 on）处理，不阻断引导
    });
  });
}

/** 已成功授权过（任一次）→ 引导横幅隐藏 */
function isAccepted() {
  try { return !!wx.getStorageSync(STORE_ACCEPTED); } catch (e) { return false; }
}
function markAccepted() {
  try { wx.setStorageSync(STORE_ACCEPTED, Date.now()); } catch (e) {}
}

/** 说明弹窗频控：7 天内已弹过该节点返回 false */
function shouldShowGuideModal(node) {
  try {
    const last = Number(wx.getStorageSync(STORE_PREFIX_GUIDE + node)) || 0;
    return Date.now() - last > GUIDE_INTERVAL_MS;
  } catch (e) { return true; }
}
function markGuideModalShown(node) {
  try { wx.setStorageSync(STORE_PREFIX_GUIDE + node, Date.now()); } catch (e) {}
}

module.exports = {
  SUBSCRIBE_TMPL_IDS,
  hasTemplateIds,
  requestSubscribe,
  getSubscribeStatus,
  isAccepted,
  markAccepted,
  shouldShowGuideModal,
  markGuideModalShown
};
