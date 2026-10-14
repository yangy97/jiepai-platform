/**
 * utils/request.js
 * 职责：封装 wx.request 为 Promise，统一处理 {code,message,data} 响应体。
 *  - 自动携带 Authorization: Bearer <token>
 *  - code !== 0 时 wx.showToast 显示 message
 *  - 401 时清理本地登录态并跳转登录页
 *  - 导出 get/post/put/del、uploadAvatar 与 token/user 相关工具方法
 */
const { BASE_URL } = require('../config');

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

// —— 登录态 ——
function setToken(token) {
  wx.setStorageSync(TOKEN_KEY, token || '');
}
function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}
function clearToken() {
  wx.removeStorageSync(TOKEN_KEY);
}
function setUser(user) {
  wx.setStorageSync(USER_KEY, user || null);
}
function getUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null;
  } catch (e) {
    return null;
  }
}
function clearUser() {
  wx.removeStorageSync(USER_KEY);
}
function isLogin() {
  return !!getToken();
}
/** 退出登录：清理本地全部登录态 */
function logout() {
  clearToken();
  clearUser();
}
/** 跳转登录页（带 redirect 可选） */
function goLogin() {
  wx.navigateTo({ url: '/pages/login/login' });
}

/** 401 统一处理：清缓存 + 跳登录 */
function handleUnauthorized() {
  const pages = getCurrentPages();
  const cur = pages[pages.length - 1];
  const route = cur ? cur.route : '';
  logout();
  if (route === 'pages/login/login') return;
  goLogin();
}

/**
 * 核心请求方法
 * @param {string} url    以 / 开头的接口路径
 * @param {string} method
 * @param {object} data   请求体或查询参数
 * @param {object} opts   { silent: true 时不弹 toast }
 */
function request(url, method, data, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) header.Authorization = 'Bearer ' + token;

    // GET 时 data 作为 query 传给 wx.request，其余方法作为 body
    const reqData = data || {};

    wx.request({
      url: BASE_URL + url,
      method,
      data: reqData,
      header,
      success(res) {
        const body = res.data || {};
        const code = typeof body.code === 'undefined' ? -1 : body.code;
        if (code === 0) {
          resolve(body.data);
          return;
        }
        // 业务失败（403 受限、409 状态冲突等统一把服务端 message toast 出来）
        const msg = body.message || '请求失败';
        if (!opts.silent) {
          wx.showToast({ title: String(msg).slice(0, 40), icon: 'none', duration: 2500 });
        }
        if (code === 401) {
          handleUnauthorized();
        }
        const err = new Error(msg);
        err.code = code;
        err.data = body.data;
        reject(err);
      },
      fail(err) {
        if (!opts.silent) {
          wx.showToast({ title: '网络异常，请稍后再试', icon: 'none' });
        }
        reject(new Error(err && err.errMsg ? err.errMsg : 'network error'));
      }
    });
  });
}

/**
 * 上传头像（微信头像昵称填写能力，docs/API.md 2.1）
 * wx.uploadFile 返回的 res.data 是 JSON 字符串，需手动 parse。
 * @param {string} filePath 头像临时路径（button open-type="chooseAvatar" 返回）
 * @returns {Promise<object>} resolve 服务端返回的 user
 */
function uploadAvatar(filePath) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      reject(new Error('未登录'));
      return;
    }
    wx.uploadFile({
      url: BASE_URL + '/api/user/avatar',
      filePath,
      name: 'file',
      header: { Authorization: 'Bearer ' + token },
      success(res) {
        let body = {};
        try {
          body = typeof res.data === 'string' ? JSON.parse(res.data) : (res.data || {});
        } catch (e) {
          body = {};
        }
        const code = typeof body.code === 'undefined' ? -1 : body.code;
        if (code === 0) {
          resolve((body.data && body.data.user) || null);
          return;
        }
        const msg = body.message || '上传失败';
        wx.showToast({ title: String(msg).slice(0, 20), icon: 'none', duration: 2000 });
        if (code === 401) {
          handleUnauthorized();
        }
        const err = new Error(msg);
        err.code = code;
        reject(err);
      },
      fail(err) {
        wx.showToast({ title: '网络异常，请稍后再试', icon: 'none' });
        reject(new Error(err && err.errMsg ? err.errMsg : 'network error'));
      }
    });
  });
}

function get(url, data, opts) {
  return request(url, 'GET', data, opts);
}
function post(url, data, opts) {
  return request(url, 'POST', data, opts);
}
function put(url, data, opts) {
  return request(url, 'PUT', data, opts);
}
function del(url, data, opts) {
  return request(url, 'DELETE', data, opts);
}

module.exports = {
  request,
  get,
  post,
  put,
  del,
  uploadAvatar,
  setToken,
  getToken,
  clearToken,
  setUser,
  getUser,
  clearUser,
  isLogin,
  logout,
  goLogin
};
