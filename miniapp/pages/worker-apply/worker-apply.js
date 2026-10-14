/**
 * pages/worker-apply/worker-apply.js
 * 职责：师傅入驻认证表单。
 *  - 进入先 GET /api/worker/profile：approved 已认证态 / pending 审核中 / rejected 驳回可重提 / null 表单
 *  - GET /api/categories 提供可接服务类目多选（skills: number[]）
 *  - 提交 POST /api/worker/apply
 */
const { get, post, isLogin } = require('../../utils/request');
const { YEARS_OPTIONS, YEARS_VALUES } = require('../../constants/index');
const { isAccepted, shouldShowGuideModal, markGuideModalShown } = require('../../utils/subscribe');

Page({
  data: {
    initLoading: true,
    profile: null,           // worker 对象或 null
    statusText: '',          // approved / pending / rejected / disabled
    auditRemark: '',
    stats: null,

    categories: [],
    yearsOptions: YEARS_OPTIONS,
    yearsIndex: 2,

    form: {
      real_name: '',
      id_card: '',
      region: '',
      bio: ''
    },
    skills: [],              // 选中的类目 id
    submitting: false,
    guideVisible: false      // 订阅消息说明弹窗（docs/changes/008）
  },

  onLoad() {
    if (!isLogin()) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.init();
  },

  init() {
    this.setData({ initLoading: true });
    Promise.all([this.loadProfile(), this.loadCategories()])
      .catch(() => {})
      .then(() => {
        // 类目加载完成后按已选 skills 同步勾选态
        this.setData({ initLoading: false, categories: this.syncChecked(this.data.skills) });
      });
  },

  loadProfile() {
    return get('/api/worker/profile', null, { silent: true })
      .then((d) => {
        const worker = (d && d.worker) || null;
        const patch = { profile: worker };
        if (worker) {
          patch.statusText = worker.status;
          patch.auditRemark = worker.audit_remark || '';
          // 回填表单
          patch.form = {
            real_name: worker.real_name || '',
            id_card: worker.id_card || '',
            region: worker.region || '',
            bio: worker.bio || ''
          };
          patch.skills = String(worker.skills || '')
            .split(',')
            .filter((s) => s !== '')
            .map((s) => Number(s));
          const yi = YEARS_VALUES.indexOf(Number(worker.years));
          patch.yearsIndex = yi >= 0 ? yi : 2;
        }
        this.setData(patch);
      })
      .catch(() => {
        // 未入驻等情况静默处理
        this.setData({ profile: null, statusText: '' });
      });
  },

  loadCategories() {
    return get('/api/categories')
      .then((d) => {
        const list = ((d && d.list) || []).map((c) =>
          Object.assign({}, c, {
            _checked: this.data.skills.indexOf(c.id) >= 0
          })
        );
        this.setData({ categories: list });
      })
      .catch(() => {});
  },

  /** 同步类目勾选状态 */
  syncChecked(skills) {
    const categories = this.data.categories.map((c) =>
      Object.assign({}, c, { _checked: skills.indexOf(c.id) >= 0 })
    );
    return categories;
  },

  /* —— 表单输入 —— */
  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },
  onYearsChange(e) {
    this.setData({ yearsIndex: Number(e.detail.value) });
  },
  toggleSkill(e) {
    const id = Number(e.currentTarget.dataset.id);
    let skills = this.data.skills.slice();
    if (skills.indexOf(id) >= 0) {
      skills = skills.filter((s) => s !== id);
    } else {
      skills.push(id);
    }
    this.setData({ skills, categories: this.syncChecked(skills) });
  },

  /* —— 提交 —— */
  submit() {
    const { form, skills, yearsIndex, submitting } = this.data;
    if (submitting) return;
    if (!form.real_name || !form.real_name.trim()) {
      wx.showToast({ title: '请填写真实姓名', icon: 'none' });
      return;
    }
    if (!/^\d{15}(\d{2}[0-9Xx])?$/.test((form.id_card || '').trim())) {
      wx.showToast({ title: '请填写正确的身份证号', icon: 'none' });
      return;
    }
    if (!form.region || !form.region.trim()) {
      wx.showToast({ title: '请填写服务区域', icon: 'none' });
      return;
    }
    if (skills.length === 0) {
      wx.showToast({ title: '请至少选择一个服务类目', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    post('/api/worker/apply', {
      real_name: form.real_name.trim(),
      id_card: form.id_card.trim(),
      region: form.region.trim(),
      skills,
      years: YEARS_VALUES[yearsIndex] || 0,
      bio: (form.bio || '').trim()
    })
      .then(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: '已提交，等待审核', icon: 'success' });
        this.init();
        // 关键节点订阅引导（docs/changes/008）：未授权过且该节点 7 天未弹 → 弹说明弹窗
        if (!isAccepted() && shouldShowGuideModal('worker_apply')) {
          markGuideModalShown('worker_apply');
          this.setData({ guideVisible: true });
        }
      })
      .catch(() => this.setData({ submitting: false }));
  },

  /** 驳回/审核中 → 回到表单修改（表单已回填原资料） */
  reedit() {
    this.setData({ statusText: '' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  /** 订阅引导弹窗关闭（subscribe-guide 组件回调） */
  onGuideDone() {
    this.setData({ guideVisible: false });
  }
});
