/**
 * 用户接口：头像上传（微信头像昵称能力）
 */
import { ok, asyncHandler } from '../../util/express-helper';
import * as userService from '../service/user.service';

export default (router: import('express').Router) => {
  // multipart 字段名固定为 file（小程序 wx.uploadFile 的 name）
  router.post(
    '/user/avatar',
    userService.upload.single('file'),
    asyncHandler(async (req, res) => {
      ok(res, await userService.saveAvatar(req.user!.id, req.file));
    }),
  );
};
