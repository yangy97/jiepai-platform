/**
 * Express 应用装配
 */
import path from 'path';
import express from 'express';
import cors from 'cors';
import createRouter from './app/router';
import { errorHandler } from './util/response';
import config from './config/config.default';

function createApp() {
  // 启动校验：PAY_MOCK=0（真实模式）下 WXPAY_* 缺失/占位 → 直接 throw 中文错误
  config.validatePayConfig();
  // 启动校验：SUBSCRIBE_MOCK=0（真实推送）下凭证/模板 ID 缺失或占位 → 直接 throw 中文错误
  config.validateSubscribeConfig();

  const app = express();

  app.use(cors());
  // 签名验证（微信支付回调）需要原始 body，用 verify 缓存一份 Buffer
  app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }));

  // 简易访问日志
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        // eslint-disable-next-line no-console
        console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - start}ms`);
      }
    });
    next();
  });

  app.get('/api/health', (req, res) => res.json({ code: 0, message: 'ok', data: { up: true } }));

  // 头像等上传文件静态托管（users.avatar 存 /uploads/avatar/xxx，落盘于 server/uploads）
  app.use('/uploads', express.static(path.join(__dirname, '../uploads'), { maxAge: '7d' }));

  app.use('/api', createRouter());

  // 未匹配的 API
  app.use('/api', (req, res) => res.status(404).json({ code: 404, message: '接口不存在', data: null }));

  app.use(errorHandler);
  return app;
}

export default createApp;
