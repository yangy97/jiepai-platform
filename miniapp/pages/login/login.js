/**
 * pages/login/login.js
 * 职责：登录 / 注册页。
 *  - 密码登录（POST /api/auth/login {phone,password}）
 *  - 验证码登录（POST /api/auth/sms-code 取固定验证码，再 login {phone,code}）
 *  - 注册（POST /api/auth/register {phone,code,password,name,role}）
 *  - 注册头像：button open-type="chooseAvatar" 拿临时路径，注册成功后 uploadAvatar 上传
 *  - 演示账号快捷填充
 */
const { post, setToken, setUser, uploadAvatar } = require('../../utils/request');
const app = getApp();

Page({
  data: {
    mode: 'login',          // login | register
    loginType: 'password',   // password | sms
    phone: '',
    password: '',
    code: '',
    // 注册表单
    regPhone: '',
    regCode: '',
    regPassword: '',
    regName: '',
    regRole: 'customer',
    registerAvatar: '',     // 已选头像临时路径（chooseAvatar 返回）
    sending: false,
    submitting: false,
    countdown: 0
  },

  /* —— 通用输入 —— */
  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value });
  },
  /* —— 头像选择（微信头像昵称填写能力） —— */
  onChooseAvatar(e) {
    this.setData({ registerAvatar: (e && e.detail && e.detail.avatarUrl) || '' });
  },
  onRoleChange(e) {
    this.setData({ regRole: e.currentTarget.dataset.role });
  },
  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },
  switchLoginType(e) {
    this.setData({ loginType: e.currentTarget.dataset.type });
  },

  /* —— 演示账号快捷填充 —— */
  fillDemo(e) {
    const role = e.currentTarget.dataset.role; // customer | worker
    if (role === 'worker') {
      this.setData({ phone: '13800000011', password: '123456', loginType: 'password', mode: 'login' });
    } else {
      this.setData({ phone: '13800000001', password: '123456', loginType: 'password', mode: 'login' });
    }
    wx.showToast({ title: '已填充演示账号', icon: 'none' });
  },

  /* —— 发送验证码（演示固定 123456） —— */
  sendCode() {
    const phone = (this.data.mode === 'register' ? this.data.regPhone : this.data.phone) || '';
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' });
      return;
    }
    if (this.data.countdown > 0) return;
    this.setData({ sending: true });
    post('/api/auth/sms-code', { phone })
      .then((d) => {
        this.setData({ sending: false, countdown: 60 });
        wx.showToast({ title: '验证码：' + ((d && d.code) || '123456'), icon: 'none' });
        this.startCountdown();
      })
      .catch(() => this.setData({ sending: false }));
  },
  startCountdown() {
    const timer = setInterval(() => {
      const c = this.data.countdown - 1;
      if (c <= 0) {
        clearInterval(timer);
        this.setData({ countdown: 0 });
      } else {
        this.setData({ countdown: c });
      }
    }, 1000);
    this._timer = timer;
  },
  onHide() {
    if (this._timer) clearInterval(this._timer);
  },
  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },

  /* —— 登录 —— */
  doLogin() {
    const { phone, password, code, loginType, submitting } = this.data;
    if (submitting) return;
    if (!/^1\d{10}$/.test(phone || '')) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' });
      return;
    }
    const payload = { phone };
    if (loginType === 'password') {
      if (!password) {
        wx.showToast({ title: '请输入密码', icon: 'none' });
        return;
      }
      payload.password = password;
    } else {
      if (!code) {
        wx.showToast({ title: '请输入验证码', icon: 'none' });
        return;
      }
      payload.code = code;
    }
    this.setData({ submitting: true });
    post('/api/auth/login', payload)
      .then((d) => this.onLoginSuccess(d))
      .catch(() => this.setData({ submitting: false }));
  },

  /* —— 注册 —— */
  doRegister() {
    const { regPhone, regCode, regPassword, regName, regRole, submitting } = this.data;
    if (submitting) return;
    if (!/^1\d{10}$/.test(regPhone || '')) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' });
      return;
    }
    if (!regCode) {
      wx.showToast({ title: '请输入验证码', icon: 'none' });
      return;
    }
    if (!regPassword || regPassword.length < 6) {
      wx.showToast({ title: '密码至少 6 位', icon: 'none' });
      return;
    }
    if (!regName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    post('/api/auth/register', {
      phone: regPhone,
      code: regCode,
      password: regPassword,
      name: regName,
      role: regRole
    })
      .then((d) => this.afterRegister(d))
      .catch(() => this.setData({ submitting: false }));
  },

  /* 注册成功后：若已选头像则先上传，再统一走成功逻辑 */
  afterRegister(d) {
    const avatar = this.data.registerAvatar;
    if (!avatar) {
      this.onLoginSuccess(d, '注册成功');
      return;
    }
    uploadAvatar(avatar)
      .then((u) => {
        // 用接口返回的 user 更新本地（含最新 avatar）
        this.onLoginSuccess(Object.assign({}, d, { user: u || d.user }), '注册成功');
      })
      .catch(() => {
        // 头像上传失败不影响注册结果
        this.onLoginSuccess(d, '注册成功');
      });
  },

  onLoginSuccess(d, tip) {
    const token = d && d.token;
    const user = d && d.user;
    setToken(token);
    setUser(user);
    app.setLoginState(user, token);
    this.setData({ submitting: false });
    this.bindWxOpenid();
    wx.showToast({ title: tip || '登录成功', icon: 'success', duration: 1200 });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/index/index' });
    }, 600);
  },

  /* 静默绑定微信 openid（订阅消息推送需要 touser=openid；失败静默，mock 模式服务端返回 {mock:true}） */
  bindWxOpenid() {
    wx.login({
      success: (res) => {
        if (!res.code) return;
        post('/api/auth/wx-code', { code: res.code }, { silent: true }).catch(() => {});
      },
      fail: () => {}
    });
  }
});
