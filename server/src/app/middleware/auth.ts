/**
 * 鉴权中间件
 *  - authorization: Bearer <token>
 */
import type { NextFunction, Response } from 'express';
import { verify } from '../../util/jwt';
import { unauthorized, forbidden } from '../../util/response';
import type { AuthedRequest, UserRole } from '../../types';

/** 解析 token，注入 req.user；未登录不拦截（可选鉴权） */
export function attachUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) {
    try {
      req.user = verify(token);
    } catch (e) {
      req.user = null;
    }
  }
  next();
}

/** 必须登录 */
export function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

/** 必须是指定角色（可多角色） */
export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('无权限执行该操作'));
    next();
  };
}
