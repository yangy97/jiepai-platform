/**
 * 认证服务：登录 / 注册 / 验证码 / 当前用户
 * Sequelize 迁移：全部走 User 模型。
 */
import bcrypt from 'bcryptjs';
import { User } from '../../db/models';
import * as jwt from '../../util/jwt';
import { badRequest, unauthorized, conflict } from '../../util/response';
import config from '../../config/config.default';
import * as wechatpay from './wechatpay';
import type { UserRole } from '../../types';

export const DEMO_SMS_CODE = '123456';

/** users 行 → 对外公开的用户信息（不带 password/openid） */
export interface PublicUser {
  id: number;
  phone: string;
  name: string;
  avatar: string;
  role: UserRole;
}

/** 与迁移前 toPublicUser 行类型兼容（UserRow / User 模型实例均可） */
interface UserLike {
  id: number;
  phone: string;
  name: string;
  avatar: string;
  role: UserRole;
}

function toPublicUser(u: UserLike | null | undefined): PublicUser | null {
  if (!u) return null;
  return { id: u.id, phone: u.phone, name: u.name, avatar: u.avatar, role: u.role };
}

export async function smsCode(phone: string) {
  if (!phone) throw badRequest('请输入手机号');
  return { code: DEMO_SMS_CODE, expire_in: 300 };
}

export async function login({ phone, password, code }: { phone?: string; password?: string; code?: string }) {
  if (!phone) throw badRequest('请输入手机号');
  const user = await User.findOne({ where: { phone } });
  if (!user) throw unauthorized('账号不存在');

  if (password) {
    if (!bcrypt.compareSync(password, user.password)) throw unauthorized('密码错误');
  } else if (code) {
    if (code !== DEMO_SMS_CODE) throw unauthorized('验证码错误');
  } else {
    throw badRequest('请提供密码或验证码');
  }

  if (user.status === 0) throw unauthorized('账号已被停用');

  return { token: jwt.sign(user), user: toPublicUser(user) };
}

export async function register({ phone, code, password, name, role }: {
  phone?: string;
  code?: string;
  password?: string;
  name?: string;
  role?: string;
}) {
  if (!phone || !password || !name) throw badRequest('手机号、密码、昵称必填');
  if (code !== DEMO_SMS_CODE) throw badRequest('验证码错误');
  if (!['customer', 'worker'].includes(role as string)) throw badRequest('角色不合法');
  if (String(password).length < 6) throw badRequest('密码至少 6 位');

  const exists = await User.findOne({ where: { phone }, attributes: ['id'] });
  if (exists) throw conflict('该手机号已注册');

  const created = await User.create({
    phone,
    password: bcrypt.hashSync(password, 10),
    name,
    avatar: '',
    role: role as UserRole,
  });
  const user = await User.findByPk(created.id);
  return { token: jwt.sign(user as User), user: toPublicUser(user) };
}

/** /auth/me：迁移前为 `SELECT id, phone, name, avatar, role, status, created_at`（响应键序须一致） */
export async function me(userId: number) {
  const user = await User.findOne({
    where: { id: userId },
    attributes: ['id', 'phone', 'name', 'avatar', 'role', 'status', 'created_at'],
  });
  if (!user) throw unauthorized();
  return { user: user.get({ plain: true }) };
}

/**
 * 绑定微信 openid（订阅消息推送 needs touser=openid）
 * wx.login code → code2session（与支付共用）→ 存 users.openid（支付流程也会写同一字段）
 * mock 模式（PAY_MOCK=1，appid 为占位值）下 code2session 必然失败 → 返回 {mock:true} 不落库、不报错
 */
export async function bindWxCode(userId: number, code?: string) {
  if (!code) throw badRequest('缺少 wx.login code');
  try {
    const { openid } = await wechatpay.code2session(String(code));
    await User.update({ openid }, { where: { id: userId } });
    return { ok: true };
  } catch (err) {
    if (config.pay.mock) return { ok: false, mock: true, message: (err as Error).message };
    throw badRequest(`绑定微信失败：${(err as Error).message}`);
  }
}

export { toPublicUser };
