/**
 * 管理端接口 /api/admin/*（需 role=admin）
 */
import { ok, asyncHandler } from '../../util/express-helper';
import * as adminService from '../service/admin.service';
import * as orderService from '../service/order.service';
import * as walletService from '../service/wallet.service';
import * as payService from '../service/pay.service';
import * as notificationService from '../service/notification.service';
import * as restrictService from '../service/restrict.service';

export default (router: import('express').Router) => {
  // ---------- 概览 ----------
  router.get('/admin/dashboard', asyncHandler(async (req, res) => {
    ok(res, await adminService.dashboard());
  }));

  // ---------- 订单 ----------
  router.get('/admin/orders', asyncHandler(async (req, res) => {
    ok(res, await orderService.adminList(req.query));
  }));

  router.get('/admin/orders/:id', asyncHandler(async (req, res) => {
    ok(res, await orderService.adminDetail(Number(req.params.id)));
  }));

  router.post('/admin/orders', asyncHandler(async (req, res) => {
    ok(res, await orderService.adminCreate(req.user!, req.body));
  }));

  router.post('/admin/orders/:id/dispatch', asyncHandler(async (req, res) => {
    ok(res, await orderService.dispatch(Number(req.params.id), req.user!, req.body));
  }));

  router.post('/admin/orders/:id/handling', asyncHandler(async (req, res) => {
    ok(res, await orderService.handling(Number(req.params.id), req.user!, req.body));
  }));

  router.post('/admin/orders/:id/cancel', asyncHandler(async (req, res) => {
    ok(res, await orderService.cancel(Number(req.params.id), req.user!, req.body));
  }));

  // 手动退款（支持部分金额）：body { amount?, reason? } 缺省全额；仅 paid 可退，completed 409
  router.post('/admin/orders/:id/refund', asyncHandler(async (req, res) => {
    ok(res, await payService.refund(Number(req.params.id), req.user!, req.body || {}));
  }));

  // ---------- 师傅 ----------
  router.get('/admin/workers', asyncHandler(async (req, res) => {
    ok(res, await adminService.workerList(req.query));
  }));

  router.get('/admin/workers/:id', asyncHandler(async (req, res) => {
    ok(res, await adminService.workerDetail(Number(req.params.id)));
  }));

  router.post('/admin/workers/:id/audit', asyncHandler(async (req, res) => {
    ok(res, await adminService.workerAudit(Number(req.params.id), req.body));
  }));

  router.patch('/admin/workers/:id', asyncHandler(async (req, res) => {
    ok(res, await adminService.workerSetStatus(Number(req.params.id), req.body));
  }));

  // 手动解除接单限制（近 N 单均分过低自动限制后的运营豁免）
  router.post('/admin/workers/:id/unrestrict', asyncHandler(async (req, res) => {
    ok(res, await restrictService.unrestrictWorker(Number(req.params.id)));
  }));

  // ---------- 客户 ----------
  router.get('/admin/customers', asyncHandler(async (req, res) => {
    ok(res, await adminService.customerList(req.query));
  }));

  // 手动解除下单限制
  router.post('/admin/customers/:id/unrestrict', asyncHandler(async (req, res) => {
    ok(res, await restrictService.unrestrictCustomer(Number(req.params.id)));
  }));

  // ---------- 通知（全站分页，运营查看用） ----------
  router.get('/admin/notifications', asyncHandler(async (req, res) => {
    ok(res, await notificationService.adminList(req.query));
  }));

  // ---------- 类目 ----------
  router.get('/admin/categories', asyncHandler(async (req, res) => {
    ok(res, await adminService.categoryList());
  }));

  router.post('/admin/categories', asyncHandler(async (req, res) => {
    ok(res, await adminService.categoryCreate(req.body));
  }));

  router.put('/admin/categories/:id', asyncHandler(async (req, res) => {
    ok(res, await adminService.categoryUpdate(Number(req.params.id), req.body));
  }));

  router.delete('/admin/categories/:id', asyncHandler(async (req, res) => {
    ok(res, await adminService.categoryRemove(Number(req.params.id)));
  }));

  // ---------- 结算 ----------
  router.get('/admin/wallets', asyncHandler(async (req, res) => {
    ok(res, await walletService.adminWallets(req.query));
  }));

  router.get('/admin/wallet-logs', asyncHandler(async (req, res) => {
    ok(res, await walletService.adminLogs(req.query));
  }));
};
