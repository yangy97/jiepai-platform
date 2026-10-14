/**
 * 师傅端接口（入驻 / 统计）+ 钱包接口
 */
import type { Router } from 'express';
import { ok, asyncHandler } from '../../util/express-helper';
import * as workerService from '../service/worker.service';
import * as walletService from '../service/wallet.service';

export default (workerRouter: Router, walletRouter: Router) => {
  workerRouter.get('/worker/profile', asyncHandler(async (req, res) => {
    ok(res, await workerService.profile(req.user!.id));
  }));

  workerRouter.post('/worker/apply', asyncHandler(async (req, res) => {
    ok(res, await workerService.apply(req.user!.id, req.body));
  }));

  workerRouter.get('/worker/stats', asyncHandler(async (req, res) => {
    ok(res, await workerService.stats(req.user!.id));
  }));

  walletRouter.get('/wallet', asyncHandler(async (req, res) => {
    ok(res, await walletService.wallet(req.user!.id));
  }));

  walletRouter.get('/wallet/logs', asyncHandler(async (req, res) => {
    ok(res, await walletService.logs(req.user!.id, req.query));
  }));
};
