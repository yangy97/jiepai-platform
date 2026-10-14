/**
 * components/order-card/order-card.js
 * 职责：订单卡片组件。接收 order(Object)，计算状态样式与金额展示，点击向外触发 tap。
 *  - 「待支付」badge：仅当下单客户是当前登录用户时展示（师傅视角 / 接单大厅不出现）
 */
const { statusInfo, money } = require('../../utils/format');
const { getUser } = require('../../utils/request');

Component({
  properties: {
    order: {
      type: Object,
      value: {}
    }
  },

  observers: {
    order: function (order) {
      if (!order) return;
      const info = statusInfo(order.status);
      // 结算金额优先，其次预算
      const amount = Number(order.price) > 0 ? order.price : order.budget;
      // 支付中 badge：客户视角（customer_id 等于当前用户 id）且待支付
      const user = getUser();
      const myId = user ? user.id : null;
      const isOwner = !!(
        myId != null && order.customer_id != null &&
        Number(order.customer_id) === Number(myId)
      );
      this.setData({
        statusText: order.status_text || info.text,
        statusCls: info.cls,
        priceText: money(amount),
        showPayBadge: isOwner && order.pay_status === 'unpaid'
      });
    }
  },

  data: {
    statusText: '',
    statusCls: 'st-pending',
    priceText: '0.00',
    showPayBadge: false
  },

  methods: {
    handleTap() {
      this.triggerEvent('tap', { order: this.data.order });
    }
  }
});
