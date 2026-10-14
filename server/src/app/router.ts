/**
 * 路由汇总（参考 oa_template 的 app/router.ts 约定：集中注册）
 * 鉴权由 auth 中间件提供：attachUser 全局解析，authRequired/requireRole 在此按需挂载。
 */
import express, { Router } from 'express';
import { attachUser, authRequired, requireRole } from './middleware/auth';
import authController from './controller/auth.controller';
import homeController from './controller/home.controller';
import orderController from './controller/order.controller';
import workerController from './controller/worker.controller';
import userController from './controller/user.controller';
import adminController from './controller/admin.controller';
import * as payController from './controller/pay.controller';
import notificationController from './controller/notification.controller';

export default function createRouter(): Router {
  const router = express.Router();

  // 0. 微信支付回调：微信服务器不带 token，必须注册在 attachUser 之前（不经过任何鉴权）
  payController.notify(router);

  // 1. 全局解析 token（可选鉴权）
  router.use(attachUser);

  // 2. 公开：登录注册 / 首页 / 类目
  authController(router);
  homeController(router);

  // 3. 订单路由需登录（先挂 authRequired，再由 orderController 注册具体路径）
  const orderRouter = express.Router();
  orderRouter.use(authRequired);
  orderController(orderRouter);
  router.use(orderRouter);

  // 3.1 支付接口需登录（发起支付 / 查询支付状态；回调已在最前面注册）
  const payRouter = express.Router();
  payRouter.use(authRequired);
  payController.pay(payRouter);
  router.use(payRouter);

  // 4. 师傅 / 钱包：登录即可
  const workerRouter = express.Router();
  workerRouter.use(authRequired);
  const walletRouter = express.Router();
  walletRouter.use(authRequired);
  workerController(workerRouter, walletRouter);
  router.use(workerRouter);
  router.use(walletRouter);

  // 4. 用户（头像上传等，登录即可）+ 站内通知（登录即可）
  const userRouter = express.Router();
  userRouter.use(authRequired);
  userController(userRouter);
  notificationController(userRouter);
  router.use(userRouter);

  // 5. 管理端：必须 admin
  const adminRouter = express.Router();
  adminRouter.use(authRequired);
  adminRouter.use(requireRole('admin'));
  adminController(adminRouter);
  router.use(adminRouter);

  return router;
}
