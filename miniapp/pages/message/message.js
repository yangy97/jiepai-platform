/**
 * pages/message/message.js
 * 职责：消息中心（站内通知列表，docs/API.md notifications 两个接口）。
 *  - GET /api/notifications?page=&page_size= 分页拉取（标题/内容/时间/未读圆点）
 *  - onShow 自动刷新；下拉刷新 / 触底加载更多
 *  - 顶部「全部已读」→ POST /api/notifications/read（缺省 = 全部已读）
 *  - 点条目：未读先标记单条已读，带 order_id 的跳订单详情
 *  - 不加 tabBar 项（docs/DESIGN-phase2.md §3.2）
 */
const { get, post, isLogin } = require('../../utils/request');
const { formatTime } = require('../../utils/format');
const { isAccepted } = require('../../utils/subscribe');

const PAGE_SIZE = 20;

Page({
  data: {
    loading: true,
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    unreadCount: 0,   // 未读数（0 不显示角标）
    guideVisible: false, // 订阅消息授权引导横幅（docs/changes/008）
    marking: false    // 全部已读进行中
  },

  onShow() {
    // 订阅消息授权引导横幅：未授权时常驻
    this.setData({ guideVisible: !isAccepted() });
    if (!isLogin()) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.reload();
  },

  /** 订阅引导授权成功（subscribe-guide 组件回调）→ 隐藏横幅 */
  onGuideDone() {
    this.setData({ guideVisible: false });
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

  /* —— 列表加载 —— */
  reload() {
    this.setData({ page: 1, hasMore: true, list: [], loading: true });
    return this.fetchPage(1, false);
  },
  loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.fetchPage(this.data.page + 1, true);
  },
  fetchPage(page, append) {
    return get('/api/notifications', { page, page_size: PAGE_SIZE })
      .then((d) => {
        const list = ((d && d.list) || []).map((n) =>
          Object.assign({}, n, { _time: formatTime(n.created_at) })
        );
        const next = append ? this.data.list.concat(list) : list;
        const total = (d && d.total) || next.length;
        const patch = {
          loading: false,
          list: next,
          page,
          total,
          hasMore: next.length < total
        };
        if (d && typeof d.unread_count !== 'undefined' && d.unread_count !== null) {
          patch.unreadCount = Number(d.unread_count) || 0;
        }
        this.setData(patch);
      })
      .catch(() => this.setData({ loading: false }));
  },

  /* —— 全部已读（POST /api/notifications/read，缺省 ids = 全部） —— */
  markAllRead() {
    if (this.data.marking || this.data.unreadCount === 0) return;
    this.setData({ marking: true });
    post('/api/notifications/read', {})
      .then((d) => {
        this.setData({
          marking: false,
          // 以服务端返回的 unread_count 为准（缺省视为 0）
          unreadCount:
            d && typeof d.unread_count !== 'undefined' ? Number(d.unread_count) || 0 : 0,
          list: this.data.list.map((n) => Object.assign({}, n, { is_read: 1 }))
        });
        wx.showToast({ title: '已全部标记已读', icon: 'success' });
      })
      .catch(() => this.setData({ marking: false }));
  },

  /* —— 点条目：未读先标记单条已读，有 order_id 跳订单详情 —— */
  onTapItem(e) {
    const id = Number(e.currentTarget.dataset.id);
    const item = this.data.list.find((n) => Number(n.id) === id) || null;
    if (item && Number(item.is_read) !== 1) {
      post('/api/notifications/read', { ids: [id] }, { silent: true })
        .then((d) => {
          const unread =
            d && typeof d.unread_count !== 'undefined'
              ? Number(d.unread_count) || 0
              : Math.max(0, this.data.unreadCount - 1);
          this.setData({
            unreadCount: unread,
            list: this.data.list.map((n) =>
              Number(n.id) === id ? Object.assign({}, n, { is_read: 1 }) : n
            )
          });
        })
        .catch(() => {});
    }
    if (item && item.order_id) {
      wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + item.order_id });
    }
  }
});
