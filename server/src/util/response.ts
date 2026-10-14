/**
 * 统一响应 & 业务错误
 * 成功：{ code: 0, message: 'ok', data }
 * 失败：HTTP 状态码 + { code, message, data: null }
 */
import type { NextFunction, Request, Response } from 'express';

export class BizError extends Error {
  code: number;
  httpStatus: number;

  constructor(code: number, message: string, httpStatus = code) {
    super(message);
    this.name = 'BizError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const ok = (res: Response, data: unknown = null) => res.json({ code: 0, message: 'ok', data });

export const badRequest = (message: string) => new BizError(400, message, 400);
export const unauthorized = (message = '未登录或登录已过期') => new BizError(401, message, 401);
export const forbidden = (message = '无权限') => new BizError(403, message, 403);
export const notFound = (message = '资源不存在') => new BizError(404, message, 404);
export const conflict = (message: string) => new BizError(409, message, 409);

/** 统一错误处理（挂在所有路由之后） */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof BizError) {
    return res.status(err.httpStatus).json({ code: err.code, message: err.message, data: null });
  }
  // multer：体积超限 / 类型不符
  if (err && err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? '图片大小不能超过 2MB' : `上传失败：${err.message}`;
    return res.status(400).json({ code: 400, message: msg, data: null });
  }
  if (err && err.status) {
    return res.status(err.status).json({ code: err.status, message: err.message || '请求失败', data: null });
  }
  console.error('[server error]', req.method, req.originalUrl, err);
  return res.status(500).json({ code: 500, message: err.message || '服务器内部错误', data: null });
}
