/**
 * components/subscribe-guide
 * 订阅消息授权引导（docs/changes/008 · 方案 A+B）
 * mode：
 *  - bar   ：横幅「开启微信通知」（我的 / 消息中心顶部，未授权时常驻，授权成功后页面隐藏）
 *  - modal ：居中说明弹窗（下单成功 / 入驻成功节点，7 天频控由页面控制 visible）
 * 行为：点「立即开启」（用户 tap）→ 查总开关：关闭引导 wx.openSetting；开启则 requestSubscribeMessage
 * 演示模式（config.js 未配置模板 ID）：点击提示，不弹系统授权窗
 */
const { SUBSCRIBE_TMPL_IDS, hasTemplateIds, requestSubscribe, getSubscribeStatus, markAccepted } = require('../../utils/subscribe');

Component({
  options: { addGlobalClass: true },
  properties: {
    mode: { type: String, value: 'bar' },
    visible: { type: Boolean, value: true } // bar：页面按 isAccepted 控制；modal：页面按频控控制
  },
  data: { acting: false },
  methods: {
    noop() {},

    onEnable() {
      if (this.data.acting) return;
      this.setData({ acting: true });
      getSubscribeStatus().then((st) => {
        if (st === 'off') {
          // 总开关被用户关了：requestSubscribeMessage 会被系统拒绝 → 引导去设置页打开
          this.setData({ acting: false });
          wx.showModal({
            title: '订阅消息已关闭',
            content: '微信「订阅消息」总开关处于关闭状态，请在设置中打开后再开启提醒',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting(); }
          });
          return null;
        }
        return requestSubscribe().then((res) => {
          const accepted = hasTemplateIds() && SUBSCRIBE_TMPL_IDS.some((id) => res && res[id] === 'accept');
          if (accepted) {
            markAccepted();
            // 一次性订阅：明示额度，避免用户误以为永久开启
            wx.showToast({ title: '已开启，本模板可收到 1 条通知', icon: 'none' });
            this.triggerEvent('done', { accepted: true });
          } else if (!hasTemplateIds()) {
            wx.showToast({ title: '演示模式：请在 config.js 配置模板 ID', icon: 'none' });
          } else {
            wx.showToast({ title: '未开启，可稍后再试', icon: 'none' });
          }
        });
      }).catch(() => {}).then(() => this.setData({ acting: false }));
    },

    onClose() { this.triggerEvent('done', { accepted: false }); }
  }
});
