/**
 * pages/order-detail/order-detail.js
 * 职责：订单详情 + 状态流转操作（严格按 docs/API.md 状态机）。
 *  - GET /api/orders/:id → { order, customer, worker, category, logs }
 *  - worker：pending/dispatched → /accept；accepted → /start；working → /finish(price,remark)
 *             working → /abort(reason, price?) 中途退出（hourly 单不传 price，服务端按时长算）
 *  - customer：finished/aborted → /confirm；completed → /rate（总分+技术/态度/准时+标签+评论）
 *              pending/dispatched/accepted/working → /cancel(reason)（strict 开工后 409）
 *  - worker 回评客户：completed → /rate-worker(rating, tags, comment)
 *  - 支付：下单客户本人 + pay_status=unpaid + 非终态 → goPay()
 *    wx.login 取 code → POST /api/pay/orders/:id → mock 直接成功 / 真实拉起 wx.requestPayment
 *    支付结果以服务端 GET /api/pay/orders/:id 轮询确认为准（最多补查 2 次）
 *  - 资金明细（支付/实收/退款/退款政策/计费方式）、aborted 中途结束信息、守时倒计时
 *  - 页面内弹层：完工提交、取消原因、中途退出、评价、回评客户
 */
const { get, post, isLogin, getUser } = require('../../utils/request');
const { statusInfo, payStatusInfo, formatTime, money, splitTags } = require('../../utils/format');
const { RATE_TAGS, WORKER_RATE_TAGS } = require('../../constants/index');

/** 标签候选 → { name, _on }（wxml 渲染选中态） */
function buildTagOptions(names) {
  return (names || []).map((n) => ({ name: n, _on: false }));
}

/** 'YYYY-MM-DD hh:mm:ss' 等格式 → 毫秒时间戳（失败返回 0） */
function parseDate(s) {
  if (!s) return 0;
  const str = String(s).replace(/-/g, '/').replace('T', ' ').replace(/\.\d+Z?$/, '');
  const t = new Date(str).getTime();
  return isNaN(t) ? 0 : t;
}

Page({
  data: {
    id: 0,
    loading: true,
    order: null,
    customer: null,
    worker: null,
    category: null,
    logs: [],
    statusText: '',
    statusCls: '',
    role: '',              // 当前登录用户角色
    acting: false,         // 操作进行中

    /* —— 支付相关 —— */
    paying: false,         // 支付流程进行中（防重复点击）
    isOwner: false,        // 当前登录用户是否为该订单的下单客户
    isWorker: false,       // 当前登录用户是否为该订单的接单师傅
    showPay: false,        // 是否展示底部「去支付」卡片
    payBadge: null,        // 支付状态徽标 { text, cls }，null 不展示

    /* —— 阶段二展示位 —— */
    showFinance: false,        // 是否渲染资金明细卡（字段存在才渲染）
    finance: null,             // { paidAmount, paidAt, actualFee, refundAmount, refundReason, refundedAt, policyText, billingText }
    abortInfo: null,           // 中途结束信息 { startedAt, abortedAt, durationText, reason }
    countdownText: '',         // 守时倒计时文案（accepted + expect_at，双方可见）
    countdownOverdue: false,   // 已超预约时间
    myRate: null,              // 客户视角「我的评价」{ rating, skill, attitude, punctual, hasDims, tags, comment }
    myWorkerRate: null,        // 师傅视角「我对客户的评价」{ rating, tags, comment }

    // 弹层：finish 完工 / cancel 取消 / abort 中途退出 / rate 评价 / wrate 回评客户
    popup: '',
    finishPrice: '',
    finishRemark: '',
    cancelReason: '',
    abortReason: '',
    abortPrice: '',
    rating: 5,
    rateSkill: 5,          // 三维：技术 1-5
    rateAttitude: 5,       // 三维：态度 1-5
    ratePunctual: 5,       // 三维：准时 1-5
    rateTags: buildTagOptions(RATE_TAGS),
    rateComment: '',
    wrRating: 5,           // 师傅回评客户总分
    wrTags: buildTagOptions(WORKER_RATE_TAGS),
    wrComment: '',
    stars: [1, 2, 3, 4, 5]
  },

  onLoad(options) {
    const id = options && Number(options.id);
    if (!id) {
      wx.showToast({ title: '订单不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    if (!isLogin()) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.setData({ id });
    this.fetch();
    // 守时倒计时：accepted + expect_at 时每 30 秒刷新一次（双方可见）
    this._cdTimer = setInterval(() => this.updateCountdown(), 30000);
  },

  onHide() {
    this.clearCountdown();
  },

  onShow() {
    // 从其它页返回：倒计时定时器恢复 + 立即刷新一次
    if (!this._cdTimer && this.data.id) {
      this._cdTimer = setInterval(() => this.updateCountdown(), 30000);
    }
    this.updateCountdown();
  },

  onUnload() {
    this.clearCountdown();
  },

  clearCountdown() {
    if (this._cdTimer) {
      clearInterval(this._cdTimer);
      this._cdTimer = null;
    }
  },

  onPullDownRefresh() {
    this.fetch().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  fetch() {
    this.setData({ loading: true });
    return get('/api/orders/' + this.data.id)
      .then((d) => {
        const order = (d && d.order) || null;
        const info = order ? statusInfo(order.status) : { text: '', cls: '' };
        const user = getUser();
        const customer = d.customer || null;
        const worker = d.worker || null;
        if (customer) customer._first = (customer.name || '客').charAt(0);
        if (worker) worker._first = (worker.real_name || '师').charAt(0);

        /* —— 支付入口判断（旧版服务端无 pay_status 字段时判断天然安全，徽标与卡片都不展示） —— */
        const myId = user ? user.id : null;
        // 服务端 customer_id 可能为 number/string，统一转 number 比较
        const isOwner = !!(
          order && myId != null && order.customer_id != null &&
          Number(order.customer_id) === Number(myId)
        );
        // 是否为该订单的接单师傅（中途退出 / 回评客户入口判断）
        const isWorker = !!(
          order && myId != null && order.worker_id != null &&
          Number(order.worker_id) === Number(myId)
        );
        // 支付状态徽标：下单客户本人可见（待支付 / 已支付 / 已退款）
        const payBadge = isOwner && order ? payStatusInfo(order.pay_status) : null;
        // 支付卡片：下单客户 + 待支付 + 非 completed/cancelled 终态
        const isTerminal = !order || order.status === 'completed' || order.status === 'cancelled';
        const showPay = !!(isOwner && order && order.pay_status === 'unpaid' && !isTerminal);

        /* —— 资金明细：字段存在才渲染（老订单无阶段二字段时整卡隐藏） —— */
        let finance = null;
        if (order) {
          const paidAt = order.paid_at ? formatTime(order.paid_at) : '';
          const actualFee =
            order.actual_fee != null && (Number(order.actual_fee) > 0 || order.status === 'aborted')
              ? money(order.actual_fee)
              : '';
          const refundAmount = Number(order.refund_amount) > 0 ? money(order.refund_amount) : '';
          const policyText = order.refund_policy
            ? (order.refund_policy_text ||
              (order.refund_policy === 'flexible' ? '支持中途退款' : '不可中途退款'))
            : '';
          const billingText = order.billing_type
            ? order.billing_type === 'hourly'
              ? '时薪 ¥' + money(order.hourly_price) + '/h'
              : (order.billing_type_text || '一口价')
            : '';
          if (paidAt || actualFee || refundAmount || policyText || billingText) {
            finance = {
              paidAmount: money(Number(order.budget) > 0 ? order.budget : order.price),
              paidAt,
              actualFee,
              refundAmount,
              refundReason: order.refund_reason || '',
              refundedAt: order.refunded_at ? formatTime(order.refunded_at) : '',
              policyText,
              billingText
            };
          }
        }

        /* —— aborted 中途结束信息：开工 → 中止、时长（到分钟）、中止原因 —— */
        let abortInfo = null;
        if (order && order.status === 'aborted') {
          let durationText = '';
          const t1 = parseDate(order.started_at);
          const t2 = parseDate(order.aborted_at);
          if (t1 && t2 && t2 > t1) {
            const mins = Math.round((t2 - t1) / 60000);
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            durationText = (h > 0 ? h + ' 小时 ' : '') + m + ' 分钟';
          }
          abortInfo = {
            startedAt: order.started_at ? formatTime(order.started_at) : '',
            abortedAt: order.aborted_at ? formatTime(order.aborted_at) : '',
            durationText,
            reason: order.abort_reason || ''
          };
        }

        /* —— 评价展示：客户看「我的评价」扩展，师傅看「我对客户的评价」 —— */
        let myRate = null;
        if (isOwner && order && order.rating) {
          myRate = {
            rating: order.rating,
            skill: order.rate_skill,
            attitude: order.rate_attitude,
            punctual: order.rate_punctual,
            hasDims: !!(order.rate_skill || order.rate_attitude || order.rate_punctual),
            tags: splitTags(order.rate_tags),
            comment: order.rate_comment || ''
          };
        }
        let myWorkerRate = null;
        if (isWorker && order && order.worker_rating) {
          myWorkerRate = {
            rating: order.worker_rating,
            tags: splitTags(order.worker_rate_tags),
            comment: order.worker_rate_comment || ''
          };
        }

        this.setData({
          loading: false,
          order,
          customer,
          worker,
          category: d.category || null,
          logs: d.logs || [],
          statusText: (order && order.status_text) || info.text,
          statusCls: info.cls,
          role: user ? user.role : '',
          isOwner,
          isWorker,
          showPay,
          payBadge,
          showFinance: !!finance,
          finance,
          abortInfo,
          myRate,
          myWorkerRate
        });
        this.updateCountdown();
        if (order && order.title) {
          wx.setNavigationBarTitle({ title: order.title.slice(0, 12) });
        }
      })
      .catch(() => this.setData({ loading: false }));
  },

  /* ================= 守时倒计时（accepted + expect_at，双方可见） ================= */
  updateCountdown() {
    const o = this.data.order;
    if (!o || o.status !== 'accepted' || !o.expect_at) {
      if (this.data.countdownText) this.setData({ countdownText: '', countdownOverdue: false });
      return;
    }
    const t = parseDate(o.expect_at);
    if (!t) return;
    const diff = t - Date.now();
    if (diff <= 0) {
      if (!this.data.countdownOverdue) this.setData({ countdownText: '已超预约时间', countdownOverdue: true });
      return;
    }
    const mins = Math.floor(diff / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const text = h > 0
      ? '距预约上门还有 ' + h + ' 小时 ' + m + ' 分'
      : '距预约上门还有 ' + m + ' 分钟';
    if (text !== this.data.countdownText || this.data.countdownOverdue) {
      this.setData({ countdownText: text, countdownOverdue: false });
    }
  },

  /* ================= 底部操作按钮判断（供 wxml 使用的计算属性） ================= */

  /* ================= 通用交互 ================= */
  copyOrderNo() {
    if (!this.data.order) return;
    wx.setClipboardData({
      data: this.data.order.order_no,
      success: () => wx.showToast({ title: '订单号已复制', icon: 'success' })
    });
  },

  openMap() {
    const o = this.data.order;
    if (!o || o.lat == null || o.lng == null) {
      wx.showToast({ title: '暂无定位信息', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: Number(o.lat),
      longitude: Number(o.lng),
      name: o.address
    });
  },

  callPhone(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: String(phone) });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  /* ================= 师傅操作 ================= */
  doAccept() {
    this.action('/accept', {});
  },
  doStart() {
    this.action('/start', {});
  },
  openFinish() {
    this.setData({
      popup: 'finish',
      finishPrice: this.data.order && Number(this.data.order.budget) > 0 ? String(this.data.order.budget) : '',
      finishRemark: ''
    });
  },
  /* —— 中途退出（working → aborted，POST /api/orders/:id/abort） —— */
  openAbort() {
    const order = this.data.order;
    this.setData({
      popup: 'abort',
      abortReason: '',
      // fixed 单默认带出预算作为实收参考；hourly 单由服务端按时长自动计算
      abortPrice: order && Number(order.budget) > 0 ? String(order.budget) : ''
    });
  },
  submitAbort() {
    const { abortReason, abortPrice, order } = this.data;
    if (!abortReason || !abortReason.trim()) {
      wx.showToast({ title: '请填写退出原因', icon: 'none' });
      return;
    }
    const payload = { reason: abortReason.trim() };
    const isHourly = !!(order && order.billing_type === 'hourly');
    if (!isHourly) {
      // fixed 单：实收金额必填、>0 且不超过预算
      const price = Number(abortPrice);
      if (!(price > 0)) {
        wx.showToast({ title: '请填写实收金额', icon: 'none' });
        return;
      }
      const budget = order ? Number(order.budget) : 0;
      if (budget > 0 && price > budget) {
        wx.showToast({ title: '实收金额不能超过预算 ¥' + money(budget), icon: 'none' });
        return;
      }
      payload.price = price;
    }
    // hourly 单不传 price：服务端按时长公式（半小时向上取整 × 时薪）自动计算
    this.setData({ popup: '' });
    this.action('/abort', payload, '已提交中途结束');
  },
  closePopup() {
    this.setData({ popup: '' });
  },
  onPopupInput(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value });
  },
  submitFinish() {
    const { finishPrice, finishRemark } = this.data;
    if (!finishPrice || !(Number(finishPrice) > 0)) {
      wx.showToast({ title: '请填写结算金额', icon: 'none' });
      return;
    }
    this.setData({ popup: '' });
    this.action('/finish', { price: Number(finishPrice), remark: finishRemark || '' });
  },
  contactSupport() {
    wx.showModal({
      title: '联系运营',
      content: '如需改派或取消派单，请联系平台运营：400-000-0000（演示）',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /* ================= 客户操作 ================= */
  doConfirm() {
    const that = this;
    const order = this.data.order;
    // aborted：确认实收金额后结算入账（POST /api/orders/:id/confirm）
    const content = order && order.status === 'aborted'
      ? '确认实收金额 ¥' + money(order.actual_fee) + ' 并完成结算？'
      : '确认服务已完成并结算给师傅？';
    wx.showModal({
      title: order && order.status === 'aborted' ? '确认结算' : '确认完成',
      content,
      success(res) {
        if (res.confirm) that.action('/confirm', {}, order && order.status === 'aborted' ? '结算成功' : undefined);
      }
    });
  },
  openCancel() {
    this.setData({ popup: 'cancel', cancelReason: '' });
  },
  submitCancel() {
    const reason = this.data.cancelReason;
    if (!reason || !reason.trim()) {
      wx.showToast({ title: '请填写取消原因', icon: 'none' });
      return;
    }
    this.setData({ popup: '' });
    this.action('/cancel', { reason: reason.trim() });
  },

  /* ================= 客户评价（总分 + 技术/态度/准时 + 快捷标签，docs/API.md rate 扩展） ================= */
  openRate() {
    this.setData({
      popup: 'rate',
      rating: 5,
      rateSkill: 5,
      rateAttitude: 5,
      ratePunctual: 5,
      rateTags: buildTagOptions(RATE_TAGS),
      rateComment: ''
    });
  },
  setRating(e) {
    this.setData({ rating: Number(e.currentTarget.dataset.star) });
  },
  /* 三维星级：data-key 指向 rateSkill / rateAttitude / ratePunctual */
  setDim(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: Number(e.currentTarget.dataset.star) });
  },
  /* 快捷标签：最多 3 个 */
  toggleRateTag(e) {
    const i = Number(e.currentTarget.dataset.index);
    const list = this.data.rateTags.map((t) => ({ name: t.name, _on: t._on }));
    const item = list[i];
    if (!item) return;
    if (!item._on && list.filter((t) => t._on).length >= 3) {
      wx.showToast({ title: '最多选择 3 个标签', icon: 'none' });
      return;
    }
    item._on = !item._on;
    this.setData({ rateTags: list });
  },
  submitRate() {
    const { rating, rateSkill, rateAttitude, ratePunctual, rateTags, rateComment } = this.data;
    const tags = rateTags.filter((t) => t._on).map((t) => t.name);
    this.setData({ popup: '' });
    this.action(
      '/rate',
      {
        rating,
        skill: rateSkill,
        attitude: rateAttitude,
        punctual: ratePunctual,
        tags,
        comment: rateComment || ''
      },
      '评价成功'
    );
  },

  /* ================= 师傅回评客户（completed 且未评过 → rate-worker） ================= */
  openRateWorker() {
    this.setData({
      popup: 'wrate',
      wrRating: 5,
      wrTags: buildTagOptions(WORKER_RATE_TAGS),
      wrComment: ''
    });
  },
  setWrRating(e) {
    this.setData({ wrRating: Number(e.currentTarget.dataset.star) });
  },
  toggleWrTag(e) {
    const i = Number(e.currentTarget.dataset.index);
    const list = this.data.wrTags.map((t) => ({ name: t.name, _on: t._on }));
    const item = list[i];
    if (!item) return;
    if (!item._on && list.filter((t) => t._on).length >= 3) {
      wx.showToast({ title: '最多选择 3 个标签', icon: 'none' });
      return;
    }
    item._on = !item._on;
    this.setData({ wrTags: list });
  },
  submitRateWorker() {
    const { wrRating, wrTags, wrComment } = this.data;
    const tags = wrTags.filter((t) => t._on).map((t) => t.name);
    this.setData({ popup: '' });
    this.action('/rate-worker', { rating: wrRating, tags, comment: wrComment || '' }, '评价成功');
  },

  /* ================= 客户支付 ================= */
  /**
   * 去支付（仅下单客户 + 待支付 + 非终态时可见）
   * 1. wx.login 取 code（失败时传空继续）→ 2. POST /api/pay/orders/:id
   * 3. mock:true → toast 支付成功 → 刷新订单详情
   * 4. mock:false → wx.requestPayment → 成功后以服务端查询结果为准
   */
  goPay() {
    if (this.data.paying) return; // 防重复点击
    const order = this.data.order;
    if (!order || order.pay_status !== 'unpaid') return;
    if (!isLogin()) {
      this.goLogin();
      return;
    }
    this.setData({ paying: true });
    wx.login({
      success: (res) => this.requestPay((res && res.code) || ''),
      fail: () => this.requestPay('')
    });
  },

  /** 2. 发起支付，拿到 PayParams（mock / 真实两种形态） */
  requestPay(code) {
    post('/api/pay/orders/' + this.data.id, { code })
      .then((resp) => this.handlePayResp(resp || {}))
      .catch(() => this.setData({ paying: false }));
  },

  /** 3/4. 按 mock / 真实分流 */
  handlePayResp(resp) {
    // mock 模式：服务端已直接置 paid，无需拉起收银台
    if (resp.mock === true) {
      wx.showToast({ title: '支付成功', icon: 'success' });
      this.fetch().then(() => this.setData({ paying: false }));
      return;
    }
    // 真实模式：拉起微信收银台
    if (resp.mock === false && resp.payment) {
      const p = resp.payment;
      wx.requestPayment({
        timeStamp: p.timeStamp,
        nonceStr: p.nonceStr,
        package: p.package,
        signType: p.signType,
        paySign: p.paySign,
        // 5. 支付结果以服务端确认为准
        success: () => this.confirmPaid(0),
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') > -1) {
            // 用户取消：订单仍为待支付，可重试
            wx.showToast({ title: '已取消支付', icon: 'none' });
          } else {
            wx.showToast({ title: '支付失败', icon: 'none' });
          }
          this.setData({ paying: false });
          this.fetch();
        }
      });
      return;
    }
    // 结构异常兜底
    this.setData({ paying: false });
    wx.showToast({ title: '支付参数异常，请重试', icon: 'none' });
  },

  /**
   * 5. GET /api/pay/orders/:id 确认支付状态（回调可能延迟）
   * 仍未 paid → 提示「支付结果确认中」，2 秒后再查，最多补查 2 次
   */
  confirmPaid(round) {
    get('/api/pay/orders/' + this.data.id, null, { silent: true })
      .then((d) => {
        const payStatus = d && d.order ? d.order.pay_status : '';
        if (payStatus === 'paid') {
          wx.showToast({ title: '支付成功', icon: 'success' });
          this.fetch().then(() => this.setData({ paying: false }));
          return;
        }
        if (round < 2) {
          wx.showToast({ title: '支付结果确认中', icon: 'none' });
          setTimeout(() => this.confirmPaid(round + 1), 2000);
          return;
        }
        wx.showToast({ title: '稍后可在订单详情查看结果', icon: 'none' });
        this.fetch().then(() => this.setData({ paying: false }));
      })
      .catch(() => {
        // 查询失败同样按延迟处理，最多补查 2 次
        if (round < 2) {
          setTimeout(() => this.confirmPaid(round + 1), 2000);
        } else {
          this.setData({ paying: false });
        }
      });
  },

  /* ================= 统一动作执行 ================= */
  /**
   * @param {string} suffix  接口后缀（如 /abort、/rate-worker）
   * @param {object} payload 请求体
   * @param {string} okMsg   成功 toast 文案（默认「操作成功」）
   */
  action(suffix, payload, okMsg) {
    if (this.data.acting) return;
    if (!isLogin()) {
      this.goLogin();
      return;
    }
    this.setData({ acting: true });
    // silent：错误 message 在此统一 toast（409 状态冲突 / 403 受限等原文展示）
    post('/api/orders/' + this.data.id + suffix, payload, { silent: true })
      .then((d) => {
        this.setData({ acting: false });
        const respOrder = (d && d.order) || null;
        // 取消成功且服务端已按退款规则退款 → toast 附「已退款 ¥X」
        if (suffix === '/cancel' && respOrder && Number(respOrder.refund_amount) > 0) {
          wx.showToast({
            title: '已取消 · 已退款 ¥' + money(respOrder.refund_amount),
            icon: 'none',
            duration: 2500
          });
        } else {
          wx.showToast({ title: okMsg || '操作成功', icon: 'success' });
        }
        this.fetch();
      })
      .catch((err) => {
        this.setData({ acting: false });
        this.toastErr(err);
      });
  },

  /** 统一错误 toast：优先服务端 message（working 中 strict 取消 409、受限 403 等），网络错误兜底中文 */
  toastErr(err) {
    const msg = err && err.message ? String(err.message) : '';
    if (!msg || msg === 'network error' || msg.indexOf('request:') === 0) {
      wx.showToast({ title: '网络异常，请稍后再试', icon: 'none' });
      return;
    }
    wx.showToast({ title: msg.slice(0, 40), icon: 'none', duration: 2500 });
  },

  reload() {
    this.fetch();
  }
});
