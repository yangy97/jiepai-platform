/**
 * pages/index/index.js
 * 职责：首页（tabBar）。
 *  - GET /api/home → banners/categories/notice
 *  - 类目网格 → order-create?category_id=x；末尾「自定义」格子 → order-create?custom=1
 *  - 师傅登录时顶部显示「我的需求 / 接单大厅」切换；接单大厅 GET /api/orders?status=pending，可抢单
 */
const { get, post, isLogin } = require('../../utils/request');
const { money, statusInfo } = require('../../utils/format');

Page({
  data: {
    loading: true,
    notice: '',
    categories: [],
    role: '',            // '' 未登录 | customer | worker
    homeTab: 'mine',     // worker 视角：mine 我的需求 / hall 接单大厅
    hallLoading: false,
    hallList: [],
    hallPage: 1,
    hallTotal: 0,
    hallEnd: false,
    grabbingId: 0
  },

  onLoad() {
    this.fetchHome();
  },

  onShow() {
    // 恢复登录态（可能在其它页登录/退出）
    const app = getApp();
    app.refreshLoginState();
    const user = getApp().globalData.user;
    const role = user ? user.role : '';
    const changed = role !== this.data.role;
    this.setData({ role });
    if (changed && role === 'worker' && this.data.homeTab === 'hall') {
      this.reloadHall();
    }
  },

  onPullDownRefresh() {
    const p1 = this.fetchHome();
    const p2 =
      this.data.homeTab === 'hall' && this.data.role === 'worker'
        ? this.reloadHall()
        : Promise.resolve();
    Promise.all([p1, p2]).then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  onReachBottom() {
    if (this.data.role === 'worker' && this.data.homeTab === 'hall') {
      this.loadHall(true);
    }
  },

  /* —— 首页数据 —— */
  fetchHome() {
    this.setData({ loading: true });
    return get('/api/home')
      .then((d) => {
        const categories = ((d && d.categories) || []).map((c) =>
          Object.assign({}, c, { min_price_text: money(c.min_price) })
        );
        this.setData({
          loading: false,
          notice: (d && d.notice) || '平台已为您的每一次上门服务投保',
          categories
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  /* —— worker 双 tab —— */
  switchHomeTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.homeTab) return;
    this.setData({ homeTab: tab });
    if (tab === 'hall' && this.data.hallList.length === 0) {
      this.reloadHall();
    }
  },

  /* —— 接单大厅 —— */
  reloadHall() {
    this.setData({ hallPage: 1, hallEnd: false, hallList: [], hallTotal: 0 });
    return this.loadHall(false);
  },

  loadHall(append) {
    if (this.data.hallLoading) return Promise.resolve();
    if (append && this.data.hallEnd) return Promise.resolve();
    const page = append ? this.data.hallPage + 1 : 1;
    this.setData({ hallLoading: true });
    return get('/api/orders', { status: 'pending', page, page_size: 10 })
      .then((d) => {
        const list = (d && d.list) || [];
        const total = (d && d.total) || 0;
        const mapped = list.map((o) =>
          Object.assign({}, o, {
            _statusText: statusInfo(o.status).text,
            _statusCls: statusInfo(o.status).cls,
            _price: money(Number(o.price) > 0 ? o.price : o.budget)
          })
        );
        const hallList = append ? this.data.hallList.concat(mapped) : mapped;
        this.setData({
          hallLoading: false,
          hallList,
          hallTotal: total,
          hallPage: page,
          hallEnd: hallList.length >= total
        });
      })
      .catch(() => this.setData({ hallLoading: false }));
  },

  /* —— 抢单 —— */
  grab(e) {
    const id = e.currentTarget.dataset.id;
    if (!isLogin()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    if (this.data.grabbingId) return;
    this.setData({ grabbingId: id });
    post('/api/orders/' + id + '/accept', {})
      .then(() => {
        this.setData({ grabbingId: 0 });
        wx.showToast({ title: '抢单成功', icon: 'success' });
        // 刷新大厅
        this.reloadHall();
        setTimeout(() => {
          wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
        }, 700);
      })
      .catch(() => this.setData({ grabbingId: 0 }));
  },

  /* —— 通用跳转 —— */
  goCategory(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/order-create/order-create?category_id=' + id });
  },
  /* 自定义特殊格子 → 下单页默认选中「其他 / 自定义」 */
  goCustom() {
    wx.navigateTo({ url: '/pages/order-create/order-create?custom=1' });
  },
  goCreate() {
    wx.navigateTo({ url: '/pages/order-create/order-create' });
  },
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
  },
  goOrders() {
    wx.switchTab({ url: '/pages/order-list/order-list' });
  },
  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },
  noop() {}
});
