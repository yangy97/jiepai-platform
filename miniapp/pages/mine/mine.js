/**
 * pages/mine/mine.js
 * 职责：我的（tabBar）。
 *  - 未登录：点击去登录
 *  - 师傅：GET /api/wallet（余额/收入/提现）+ GET /api/worker/stats + 入驻入口 + 钱包流水弹层 GET /api/wallet/logs
 *  - 客户：我的发布统计（GET /api/orders/mine?role=customer&page_size=1 的 total）
 *  - 头像：open-type="chooseAvatar" 选头像 → POST /api/user/avatar 上传 → setUser 刷新
 *  - 退出登录 / 关于弹层 / 角色说明
 */
const { get, isLogin, logout, setUser, uploadAvatar } = require('../../utils/request');
const { money, walletTypeText, formatTime } = require('../../utils/format');
const { isAccepted } = require('../../utils/subscribe');
const { BASE_URL } = require('../../config');

Page({
  data: {
    logged: false,
    user: null,
    loading: false,

    // 师傅
    wallet: null,
    stats: null,

    // 客户
    myOrderTotal: 0,

    // 消息中心（🔔 入口角标，0 不显示）
    unreadCount: 0,
    guideVisible: false,  // 订阅消息授权引导横幅（docs/changes/008，授权成功后隐藏）

    // 弹层
    popup: '',            // walletLogs | about | role
    logsLoading: false,
    walletLogs: [],

    avatarUploading: false // 头像上传中
  },

  /** 组装页面用的 user：首字占位 + 头像完整地址（avatar 为 / 开头的相对路径） */
  buildUser(user) {
    if (!user) return null;
    return Object.assign({}, user, {
      _first: (user.name || '客').charAt(0),
      _avatarUrl: user.avatar ? BASE_URL + user.avatar : ''
    });
  },

  onShow() {
    const app = getApp();
    app.refreshLoginState();
    // 订阅消息授权引导横幅：未授权时常驻（docs/changes/008）
    this.setData({ guideVisible: !isAccepted() });
    const user = app.globalData.user;
    if (!user || !isLogin()) {
      this.setData({ logged: false, user: null, wallet: null, stats: null, unreadCount: 0 });
      return;
    }
    this.setData({ logged: true, user: this.buildUser(user) });
    // 本地没有头像时，用服务端 /api/auth/me 的 avatar 同步一次
    if (!user.avatar) this.syncProfile();
    this.fetchData();
    // 消息未读数（onShow 每次刷新，返回本页即同步）
    this.loadUnread();
  },

  /** 未读消息数：GET /api/notifications?unread=1&page=1 → unread_count */
  loadUnread() {
    return get('/api/notifications', { unread: 1, page: 1 }, { silent: true })
      .then((d) => this.setData({ unreadCount: (d && d.unread_count) || 0 }))
      .catch(() => this.setData({ unreadCount: 0 }));
  },

  /** 订阅引导授权成功（subscribe-guide 组件回调）→ 隐藏横幅 */
  onGuideDone() {
    this.setData({ guideVisible: false });
  },

  /** 同步服务端用户资料（仅本地缺头像时） */
  syncProfile() {
    return get('/api/auth/me', null, { silent: true })
      .then((d) => {
        const srv = d && d.user;
        const local = this.data.user;
        if (!srv || !srv.avatar || !local || local.avatar) return;
        const merged = Object.assign({}, local, { avatar: srv.avatar });
        setUser(merged);
        getApp().globalData.user = merged;
        this.setData({ user: this.buildUser(merged) });
      })
      .catch(() => {});
  },

  /* —— 更换头像（微信头像昵称填写能力） —— */
  onChooseAvatar(e) {
    if (!this.data.logged || this.data.avatarUploading) return;
    const filePath = (e && e.detail && e.detail.avatarUrl) || '';
    if (!filePath) return;
    this.setData({ avatarUploading: true });
    uploadAvatar(filePath)
      .then((u) => {
        this.setData({ avatarUploading: false });
        if (!u) return;
        const merged = Object.assign({}, this.data.user, u);
        setUser(merged);
        getApp().globalData.user = merged;
        this.setData({ user: this.buildUser(merged) });
        wx.showToast({ title: '头像已更新', icon: 'success' });
      })
      .catch(() => this.setData({ avatarUploading: false }));
  },

  onPullDownRefresh() {
    this.fetchData().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  fetchData() {
    const user = this.data.user;
    if (!user) return Promise.resolve();
    this.setData({ loading: true });
    const tasks = [];
    if (user.role === 'worker') {
      tasks.push(this.loadWallet(), this.loadStats());
    } else {
      tasks.push(this.loadCustomerStat());
    }
    return Promise.all(tasks)
      .catch(() => {})
      .then(() => this.setData({ loading: false }));
  },

  loadWallet() {
    return get('/api/wallet', null, { silent: true })
      .then((d) => {
        this.setData({
          wallet: {
            balance: money((d && d.balance) || 0),
            income: money((d && d.income) || 0),
            withdrawn: money((d && d.withdrawn) || 0)
          }
        });
      })
      .catch(() => this.setData({ wallet: null }));
  },

  loadStats() {
    return get('/api/worker/stats', null, { silent: true })
      .then((d) => this.setData({ stats: d || null }))
      .catch(() => this.setData({ stats: null }));
  },

  loadCustomerStat() {
    return get('/api/orders/mine', { role: 'customer', page: 1, page_size: 1 }, { silent: true })
      .then((d) => this.setData({ myOrderTotal: (d && d.total) || 0 }))
      .catch(() => this.setData({ myOrderTotal: 0 }));
  },

  /* —— 登录 / 退出 —— */
  goLogin() {
    if (this.data.logged) return;
    wx.navigateTo({ url: '/pages/login/login' });
  },
  doLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (!res.confirm) return;
        logout();
        getApp().clearLoginState();
        this.setData({ logged: false, user: null, wallet: null, stats: null, myOrderTotal: 0, unreadCount: 0 });
        wx.showToast({ title: '已退出登录', icon: 'none' });
        setTimeout(() => wx.navigateTo({ url: '/pages/login/login' }), 700);
      }
    });
  },

  /* —— 弹层 —— */
  openWalletLogs() {
    if (!isLogin()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    this.setData({ popup: 'walletLogs', logsLoading: true, walletLogs: [] });
    get('/api/wallet/logs', { page: 1, page_size: 10 })
      .then((d) => {
        const list = ((d && d.list) || []).map((l) =>
          Object.assign({}, l, {
            _typeText: walletTypeText(l.type),
            _amount: (Number(l.amount) > 0 ? '+' : '') + money(l.amount),
            _neg: Number(l.amount) < 0,
            _time: formatTime(l.created_at)
          })
        );
        this.setData({ logsLoading: false, walletLogs: list });
      })
      .catch(() => this.setData({ logsLoading: false }));
  },
  openAbout() {
    this.setData({ popup: 'about' });
  },
  openRole() {
    this.setData({ popup: 'role' });
  },
  closePopup() {
    this.setData({ popup: '' });
  },
  stopnoop() {},

  /* —— 其它跳转 —— */
  goMessage() {
    if (!isLogin()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    wx.navigateTo({ url: '/pages/message/message' });
  },
  goWorkerApply() {
    if (!isLogin()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    wx.navigateTo({ url: '/pages/worker-apply/worker-apply' });
  },
  /* —— 切换角色演示（演示账号角色固定，引导注册另一角色） —— */
  switchRoleDemo() {
    const user = this.data.user;
    if (!user) {
      this.goLogin();
      return;
    }
    if (user.role === 'customer') {
      wx.showModal({
        title: '切换角色',
        content: '该账号为客户账号。如需体验师傅端（抢单/完工/钱包），可注册一个师傅账号。',
        confirmText: '注册师傅',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) this.goRegisterWorker();
        }
      });
    } else if (user.role === 'worker') {
      wx.showModal({
        title: '切换角色',
        content: '该账号为师傅账号。如需体验客户端（下单/评价），可注册一个客户账号。',
        confirmText: '注册客户',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/login/login' });
        }
      });
    } else {
      wx.showModal({ title: '切换角色', content: '当前为运营账号，暂不支持切换。', showCancel: false });
    }
  },
  goRegisterWorker() {
    wx.navigateTo({ url: '/pages/login/login' });
  },
  goOrders() {
    wx.switchTab({ url: '/pages/order-list/order-list' });
  },
  goCreate() {
    wx.navigateTo({ url: '/pages/order-create/order-create' });
  },
  goHall() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
