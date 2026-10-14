/**
 * 订单接口（小程序端 + 运营派单）
 */
import { ok, asyncHandler } from '../../util/express-helper';
import * as orderService from '../service/order.service';

export default (router: import('express').Router) => {
  // ---------- 客户下单 / 查询 ----------
  router.post('/orders', asyncHandler(async (req, res) => {
    ok(res, await orderService.create(req.user!, req.body));
  }));

  // 接单大厅（师傅）
  router.get('/orders', asyncHandler(async (req, res) => {
    ok(res, await orderService.hall(req.query, req.user));
  }));

  router.get('/orders/mine', asyncHandler(async (req, res) => {
    ok(res, await orderService.mine(req.user!, req.query));
  }));

  router.get('/orders/:id', asyncHandler(async (req, res) => {
    ok(res, await orderService.detail(Number(req.params.id), req.user!));
  }));

  // ---------- 师傅动作 ----------
  router.post('/orders/:id/accept', asyncHandler(async (req, res) => {
    ok(res, await orderService.accept(Number(req.params.id), req.user!));
  }));

  router.post('/orders/:id/start', asyncHandler(async (req, res) => {
    ok(res, await orderService.start(Number(req.params.id), req.user!));
  }));

  router.post('/orders/:id/finish', asyncHandler(async (req, res) => {
    ok(res, await orderService.finish(Number(req.params.id), req.user!, req.body));
  }));

  // 中途退出：working → aborted（接单师傅 / 运营）
  router.post('/orders/:id/abort', asyncHandler(async (req, res) => {
    ok(res, await orderService.abort(Number(req.params.id), req.user!, req.body || {}));
  }));

  router.post('/orders/:id/revoke-finish', asyncHandler(async (req, res) => {
    ok(res, await orderService.revokeFinish(Number(req.params.id), req.user!));
  }));

  // ---------- 客户动作 ----------
  router.post('/orders/:id/confirm', asyncHandler(async (req, res) => {
    ok(res, await orderService.confirm(Number(req.params.id), req.user!));
  }));

  router.post('/orders/:id/rate', asyncHandler(async (req, res) => {
    ok(res, await orderService.rate(Number(req.params.id), req.user!, req.body));
  }));

  // 师傅回评客户（双向评价）
  router.post('/orders/:id/rate-worker', asyncHandler(async (req, res) => {
    ok(res, await orderService.rateWorker(Number(req.params.id), req.user!, req.body || {}));
  }));

  router.post('/orders/:id/cancel', asyncHandler(async (req, res) => {
    ok(res, await orderService.cancel(Number(req.params.id), req.user!, req.body));
  }));

  // ---------- 运营动作 ----------
  router.post('/orders/:id/dispatch', asyncHandler(async (req, res) => {
    ok(res, await orderService.dispatch(Number(req.params.id), req.user!, req.body));
  }));

  router.post('/orders/:id/handling', asyncHandler(async (req, res) => {
    ok(res, await orderService.handling(Number(req.params.id), req.user!, req.body));
  }));
};
