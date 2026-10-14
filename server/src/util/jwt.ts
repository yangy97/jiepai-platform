/**
 * JWT 签发与校验
 */
import jwt, { type SignOptions } from 'jsonwebtoken';
import config from '../config/config.default';
import type { JwtPayload, UserRole } from '../types';

/** 可签发的用户信息（users 行的子集） */
export interface SignableUser {
  id: number;
  role: UserRole;
  name?: string;
  phone?: string;
}

export function sign(user: SignableUser): string {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, phone: user.phone },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] },
  );
}

export function verify(token: string): JwtPayload {
  // jsonwebtoken 的 JwtPayload 只声明 iat/exp，业务载荷（id/role/name/phone）由本服务签发，这里断言为业务载荷
  return jwt.verify(token, config.jwt.secret) as unknown as JwtPayload;
}
