/**
 * 站内通知接口（阶段二 · docs/DESIGN-phase2.md §3.2）
 *  - GET  /api/notifications          ?unread=1&page=&page_size= → { list, total, unread_count }
 *  - POST /api/notifications/read     { ids? }（缺省 = 全部已读）→ { unread_count }
 */
import { ok, asyncHandler } from '../../util/express-helper';
import * as notificationService from '../service/notification.service';

export default (router: import('express').Router) => {
  router.get('/notifications', asyncHandler(async (req, res) => {
    ok(res, await notificationService.list(req.user!.id, req.query));
  }));

  router.post('/notifications/read', asyncHandler(async (req, res) => {
    const { ids } = req.body || {};
    ok(res, await notificationService.read(req.user!.id, ids));
  }));
};
