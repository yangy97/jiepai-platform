/**
 * app.js
 * 职责：小程序入口。维护全局用户态（登录后写入），供各页面读取。
 */
const { getUser, setUser, getToken, isLogin } = require('./utils/request');

App({
  globalData: {
    user: null,
    isLogin: false
  },

  onLaunch() {
    // 从本地缓存恢复登录态
    const user = getUser();
    if (user && getToken()) {
      this.globalData.user = user;
      this.globalData.isLogin = true;
    }
  },

  /** 登录成功后由 login 页调用，同步全局态 */
  setLoginState(user, token) {
    if (token) require('./utils/request').setToken(token);
    if (user) setUser(user);
    this.globalData.user = user || null;
    this.globalData.isLogin = !!token;
  },

  /** 退出登录后同步全局态 */
  clearLoginState() {
    require('./utils/request').logout();
    this.globalData.user = null;
    this.globalData.isLogin = false;
  },

  /** 刷新全局用户态（页面 onShow 时可调用） */
  refreshLoginState() {
    const logged = isLogin();
    this.globalData.user = logged ? getUser() : null;
    this.globalData.isLogin = logged;
    return this.globalData;
  }
});
