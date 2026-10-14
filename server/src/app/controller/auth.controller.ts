/**
 * 认证接口
 */
import { ok, asyncHandler } from '../../util/express-helper';
import { authRequired } from '../middleware/auth';
import * as authService from '../service/auth.service';

export default (router: import('express').Router) => {
  // 演示环境固定验证码
  router.post('/auth/sms-code', asyncHandler(async (req, res) => {
    ok(res, await authService.smsCode(req.body.phone));
  }));

  router.post('/auth/login', asyncHandler(async (req, res) => {
    ok(res, await authService.login(req.body));
  }));

  router.post('/auth/register', asyncHandler(async (req, res) => {
    ok(res, await authService.register(req.body));
  }));

  // 绑定微信 openid（订阅消息推送用；登录成功后小程序静默调用）
  router.post('/auth/wx-code', authRequired, asyncHandler(async (req, res) => {
    ok(res, await authService.bindWxCode(req.user!.id, req.body && req.body.code));
  }));

  router.get('/auth/me', asyncHandler(async (req, res) => {
    // 原实现无 authRequired，直接解引用（保持行为一致）
    ok(res, await authService.me(req.user!.id));
  }));
};
