/**
 * 支付接口
 *  - POST /api/pay/notify  微信支付回调：不走 JWT（微信服务器不带 token），必须注册在 attachUser 之前
 *  - POST /api/pay/orders/:id  发起支付（customer，需登录）
 *  - GET  /api/pay/orders/:id  查询支付状态（需登录，下单人/接单人/admin 可见）
 */
import type { Router } from 'express';
import { ok, asyncHandler } from '../../util/express-helper';
import * as payService from '../service/pay.service';

/** 微信回调应答体（注意：签名验证用的是 app.js 中缓存的原始 body） */
export function notify(router: Router) {
  router.post('/pay/notify', async (req, res) => {
    try {
      const result = await payService.handleNotify(req.rawBody || Buffer.from(''), req.headers);
      // 成功：{"code":"SUCCESS","message":"成功"}
      res.status(200).json(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pay] 支付回调处理失败（返回 400，微信将重试）：', (err as Error).message);
      // 失败：{"code":"FAIL","message":"原因"} + HTTP 400 → 微信按失败处理并重试
      res.status(400).json({ code: 'FAIL', message: (err as Error).message || '处理失败' });
    }
  });
}

/** 支付业务接口（挂在 authRequired 子路由上） */
export function pay(router: Router) {
  // 发起支付
  router.post('/pay/orders/:id', asyncHandler(async (req, res) => {
    ok(res, await payService.createPayment(req.user!, Number(req.params.id), req.body || {}));
  }));

  // 查询支付状态（轮询用）
  router.get('/pay/orders/:id', asyncHandler(async (req, res) => {
    ok(res, await payService.queryPayment(Number(req.params.id), req.user!));
  }));
}
