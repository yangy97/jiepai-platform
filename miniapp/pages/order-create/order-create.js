/**
 * pages/order-create/order-create.js
 * 职责：发布上门服务需求。
 *  - GET /api/categories 横向类目选择（末尾固定「其他 / 自定义」项，支持 category_id / custom 预选）
 *  - 自定义服务类型：不传 category_id，改传 custom_category（docs/API.md 2.2）
 *  - wx.chooseLocation 地图选点 → address + lat/lng
 *  - 退款政策 refund_policy（flexible/strict）+ 计费方式 billing_type（fixed/hourly，按时计费填时薪）下单锁定
 *  - POST /api/orders 提交下单，成功跳订单详情
 */
const { get, post, isLogin } = require('../../utils/request');
const { money, formatTime } = require('../../utils/format');
const { CUSTOM_CATEGORY } = require('../../constants/index');
const { isAccepted, shouldShowGuideModal, markGuideModalShown } = require('../../utils/subscribe');

Page({
  data: {
    loading: true,
    categories: [],
    category: null,      // 当前所选类目
    isCustom: false,     // 是否选中「其他 / 自定义」
    customCategory: '',  // 自定义服务类型输入
    title: '',
    description: '',
    address: '',
    lat: null,           // 地图选点坐标
    lng: null,
    coordText: '',       // 展示用「已选坐标 xx, xx」
    expectAt: '',        // 展示用
    expectValue: '',     // picker 返回值
    budget: '',
    budgetEdited: false, // 客户是否手动改过预算（改过则切换类目不再覆盖预填值）
    refundPolicy: 'flexible', // 退款政策：flexible 支持中途退款（默认）| strict 不可中途退款
    billingType: 'fixed',     // 计费方式：fixed 一口价（默认）| hourly 按时计费
    hourlyPrice: '',          // 时薪（billing_type=hourly 时必填，元/小时）
    submitting: false,
    guideVisible: false       // 订阅消息说明弹窗（docs/changes/008）
  },

  onLoad(options) {
    if (!isLogin()) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.preCategoryId = options && options.category_id ? Number(options.category_id) : 0;
    // 首页「自定义」格子跳入：?custom=1 默认选中自定义
    this.preCustom = !!(options && (options.custom === '1' || options.custom === 'true'));
    this.fetchCategories();
  },

  fetchCategories() {
    this.setData({ loading: true });
    get('/api/categories')
      .then((d) => {
        const list = ((d && d.list) || []).filter((c) => Number(c.status) === 1 || c.status === undefined);
        const categories = list.map((c) => Object.assign({}, c, { min_price_text: money(c.min_price) }));
        // 末尾追加固定「其他 / 自定义」项
        categories.push(Object.assign({}, CUSTOM_CATEGORY, { min_price_text: '' }));
        let category = null;
        if (this.preCustom) {
          category = categories.find((c) => c.id === 0) || null;
        } else if (this.preCategoryId) {
          category = categories.find((c) => c.id === this.preCategoryId) || null;
        }
        if (!category && categories.length) category = categories[0];
        this.setData({
          loading: false,
          categories,
          category,
          isCustom: !!(category && category.id === 0),
          title: this.data.title || (category && category.id !== 0 ? category.name + '服务' : ''),
          // 首次进入未输入过预算：按起步价预填
          budget: this.data.budgetEdited ? this.data.budget : this.budgetOf(category)
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  /* 起步价预填：固定类目取类目起步价，自定义为空（按实际报价） */
  budgetOf(cat) {
    if (!cat || cat.id === 0) return '';
    return String(cat.min_price || '');
  },

  /* —— 类目切换 —— */
  chooseCategory(e) {
    const id = Number(e.currentTarget.dataset.id);
    const cat = this.data.categories.find((c) => c.id === id);
    if (!cat) return;
    const patch = { category: cat, isCustom: cat.id === 0 };
    // 客户没手动改过预算时，跟随类目起步价联动；改过则尊重客户输入
    if (!this.data.budgetEdited) patch.budget = this.budgetOf(cat);
    this.setData(patch);
  },

  /* —— 表单输入 —— */
  onInput(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'budget') this.setData({ budgetEdited: true });
    this.setData({ [key]: e.detail.value });
  },
  onTimeChange(e) {
    this.setData({
      expectValue: e.detail.value,
      expectAt: formatTime(e.detail.value) + ':00'
    });
  },

  /* —— 退款政策 / 计费方式（下单时锁定，下单后不可改，docs/API.md 退款规则表） —— */
  chooseRefundPolicy(e) {
    this.setData({ refundPolicy: e.currentTarget.dataset.val });
  },
  chooseBillingType(e) {
    this.setData({ billingType: e.currentTarget.dataset.val });
  },

  /* —— 地图选点（wx.chooseLocation） —— */
  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        const lat = res.latitude;
        const lng = res.longitude;
        this.setData({
          // 回填地址（可继续手动微调文字）+ 坐标
          address: res.address || this.data.address,
          lat: Number(lat),
          lng: Number(lng),
          coordText: Number(lat).toFixed(4) + ', ' + Number(lng).toFixed(4)
        });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        // 用户取消：不提示
        if (msg.indexOf('cancel') > -1 || msg.indexOf('取消') > -1) return;
        wx.showToast({ title: '地图选点失败，请手动输入地址', icon: 'none' });
      }
    });
  },

  /* —— 提交 —— */
  submit() {
    const {
      category, isCustom, customCategory, title, description,
      address, expectAt, budget, lat, lng, submitting,
      refundPolicy, billingType, hourlyPrice
    } = this.data;
    if (submitting) return;
    if (!category) {
      wx.showToast({ title: '请选择服务类目', icon: 'none' });
      return;
    }
    if (!title || !title.trim()) {
      wx.showToast({ title: '请填写需求标题', icon: 'none' });
      return;
    }
    if (!address || !address.trim()) {
      wx.showToast({ title: '请填写上门地址', icon: 'none' });
      return;
    }
    if (!budget || !(Number(budget) > 0)) {
      wx.showToast({ title: '请填写预算金额', icon: 'none' });
      return;
    }
    // 按时计费：时薪必填且 > 0
    if (billingType === 'hourly' && !(Number(hourlyPrice) > 0)) {
      wx.showToast({ title: '请填写时薪（元/小时）', icon: 'none' });
      return;
    }
    const payload = {
      title: title.trim(),
      description: (description || '').trim(),
      address: address.trim(),
      budget: Number(budget),
      // 下单锁定：退款政策 + 计费方式（下单后不可修改）
      refund_policy: refundPolicy || 'flexible',
      billing_type: billingType || 'fixed'
    };
    // 按时计费才传时薪
    if (payload.billing_type === 'hourly') payload.hourly_price = Number(hourlyPrice);
    // 服务类型：固定类目传 category_id；自定义传 custom_category（不传 category_id）
    if (isCustom) {
      const cc = (customCategory || '').trim();
      if (!cc) {
        wx.showToast({ title: '请输入服务类型', icon: 'none' });
        return;
      }
      payload.custom_category = cc;
    } else {
      payload.category_id = category.id;
    }
    if (expectAt) payload.expect_at = expectAt;
    // 地图选点坐标（有值才传）
    if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) {
      payload.lat = Number(lat);
      payload.lng = Number(lng);
    }

    this.setData({ submitting: true });
    post('/api/orders', payload)
      .then((d) => {
        const order = (d && d.order) || {};
        this.setData({ submitting: false });
        wx.showToast({ title: '下单成功', icon: 'success', duration: 1200 });
        // 关键节点订阅引导（docs/changes/008）：未授权过且该节点 7 天未弹 → 弹说明弹窗，关闭后继续跳转
        if (!isAccepted() && shouldShowGuideModal('order_create')) {
          markGuideModalShown('order_create');
          this._pendingOrderId = order.id;
          this.setData({ guideVisible: true });
          return;
        }
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/order-detail/order-detail?id=' + order.id });
        }, 700);
      })
      // 403 受限等业务错误的 message 已由 utils/request.js 统一 toast，这里仅复位提交态
      .catch(() => this.setData({ submitting: false }));
  },

  /** 订阅引导弹窗关闭（subscribe-guide 组件回调）→ 继续跳订单详情 */
  onGuideDone() {
    this.setData({ guideVisible: false });
    const id = this._pendingOrderId;
    if (id) {
      this._pendingOrderId = null;
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/order-detail/order-detail?id=' + id });
      }, 300);
    }
  }
});
