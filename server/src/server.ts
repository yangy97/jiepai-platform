/**
 * 服务入口
 */
import type { Application } from 'express';
import createApp from './app';
import config from './config/config.default';
import { getPool } from './db/pool';
import * as notificationService from './app/service/notification.service';

// 应用装配（含支付配置启动校验）：失败时给出可读中文提示后退出
let app: Application;
try {
  app = createApp();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[jiepai-server] 启动失败：', (err as Error).message);
  process.exit(1);
}

// 启动前探活数据库，失败直接给出可读提示
getPool()
  .query('SELECT 1')
  .then(() => {
    app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(`[jiepai-server] API 已启动: http://127.0.0.1:${config.port}/api`);
      // eslint-disable-next-line no-console
      console.log(`[jiepai-server] 数据库: ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`);
      // 守时扫描定时器（预约前 30min 提醒 / 超时 30min 提醒；内部有防重复注册 flag + unref）
      notificationService.startTimer();
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[jiepai-server] 数据库连接失败：', err.message);
    // eslint-disable-next-line no-console
    console.error('请先启动 MySQL，并执行 npm run db:init && npm run db:seed');
    process.exit(1);
  });
