/**
 * Express 辅助：异步路由包装 + 统一响应再导出（controller 只引这一个模块即可）
 */
import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '../types';
import { ok, BizError, badRequest, unauthorized, forbidden, notFound, conflict, errorHandler } from './response';

export type AsyncRouteHandler = (req: AuthedRequest, res: Response, next: NextFunction) => Promise<any>;

export const asyncHandler =
  (fn: AsyncRouteHandler) =>
    (req: AuthedRequest, res: Response, next: NextFunction) =>
      Promise.resolve(fn(req, res, next)).catch(next);

export { ok, BizError, badRequest, unauthorized, forbidden, notFound, conflict, errorHandler };
