/**
 * pages/order-list/order-list.js
 * 职责：订单列表（tabBar）。
 *  - 状态筛选横滑 tab（全部不传 status）
 *  - 分页加载（onReachBottom / onPullDownRefresh）
 *  - 数据源按当前登录角色：GET /api/orders/mine?role=customer|worker
 *  - 未登录显示空态 + 去登录
 */
const { get, isLogin } = require('../../utils/request');
const { STATUS_TABS } = require('../../constants/index');

const PAGE_SIZE = 10;

Page({
  data: {
    tabs: STATUS_TABS,
    activeTab: '',
    role: '',
    logged: false,
    loading: true,
    list: [],
    page: 1,
    total: 0,
    hasMore: true
  },

  onShow() {
    const app = getApp();
    app.refreshLoginState();
    const user = app.globalData.user;
    const role = user ? user.role : '';
    // 角色变化或首次进入 → 重新加载
    if (role !== this.data.role || this.data.list.length === 0) {
      this.setData({ role, logged: !!user });
      this.reload();
    } else {
      this.setData({ role, logged: !!user });
    }
  },

  onPullDownRefresh() {
    this.reload().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  onReachBottom() {
    this.loadMore();
  },

  /* —— 筛选切换 —— */
  switchTab(e) {
    const v = e.currentTarget.dataset.value;
    if (v === this.data.activeTab) return;
    this.setData({ activeTab: v });
    this.reload();
  },

  /* —— 数据加载 —— */
  reload() {
    this.setData({ page: 1, hasMore: true, list: [], loading: true });
    return this.fetch(1, false);
  },
  loadMore() {
    if (!this.data.hasMore || this.data.loading) return Promise.resolve();
    return this.fetch(this.data.page + 1, true);
  },
  fetch(page, append) {
    if (!this.data.logged) {
      this.setData({ loading: false, hasMore: false });
      return Promise.resolve();
    }
    const params = {
      role: this.data.role || 'customer',
      page,
      page_size: PAGE_SIZE
    };
    if (this.data.activeTab) params.status = this.data.activeTab;
    return get('/api/orders/mine', params)
      .then((d) => {
        const list = (d && d.list) || [];
        const total = (d && d.total) || 0;
        const nextList = append ? this.data.list.concat(list) : list;
        this.setData({
          loading: false,
          list: nextList,
          page,
          total,
          hasMore: nextList.length < total
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  /* —— 交互 —— */
  onCardTap(e) {
    const order = e.detail.order || {};
    if (!order.id) return;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + order.id });
  },
  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },
  goCreate() {
    wx.navigateTo({ url: '/pages/order-create/order-create' });
  },
  goHall() {
    wx.switchTab({ url: '/pages/index/index' });
  },
  reloadTap() {
    this.reload();
  }
});
