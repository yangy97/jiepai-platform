/**
 * 头像上传服务（微信「头像昵称填写能力」配套接口）
 * 微信不再提供 getUserProfile 静默授权，小程序用 <button open-type="chooseAvatar">
 * 拿到临时文件路径后，通过 wx.uploadFile 传到本服务落盘。
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { User } from '../../db/models';
import { BizError, badRequest } from '../../util/response';

/** 头像存储目录：server/uploads/avatar */
const AVATAR_DIR = path.join(__dirname, '../../../uploads/avatar');
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, AVATAR_DIR);
  },
  filename(req, file, cb) {
    const ext = ALLOWED[file.mimetype] || 'png';
    const name = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter(req, file, cb) {
    if (!ALLOWED[file.mimetype]) {
      return cb(new BizError(400, '仅支持 png/jpg/gif/webp 图片', 400));
    }
    cb(null, true);
  },
});

/** 保存头像并写库，返回公开用户信息 */
export async function saveAvatar(userId: number, file?: Express.Multer.File | null) {
  if (!file) throw badRequest('请选择头像图片');
  const url = `/uploads/avatar/${file.filename}`;
  try {
    await User.update({ avatar: url }, { where: { id: userId } });
  } catch (err) {
    // 写库失败时清理已落盘文件
    fs.unlink(file.path, () => {});
    throw err;
  }
  // 迁移前为 `SELECT id, phone, name, avatar, role, status FROM users WHERE id = ?`（响应键序须一致）
  const user = await User.findOne({
    where: { id: userId },
    attributes: ['id', 'phone', 'name', 'avatar', 'role', 'status'],
  });
  return { user: user ? user.get({ plain: true }) : null };
}

export { upload, AVATAR_DIR };
