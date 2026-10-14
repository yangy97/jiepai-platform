/**
 * 统一配置（参考 oa_template 的 config/config.default.ts 约定）
 * 所有环境变量集中在 .env，代码里只从这里取值。
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

/** 微信支付配置（见 docs/API.md「支付模式」） */
export interface PayConfig {
  mock: boolean;
  strict: boolean;
  appid: string;
  mchid: string;
  serialNo: string;
  privateKey: string;
  apiV3Key: string;
  notifyUrl: string;
  platformCert: string;
  clientCert: string;
  appSecret: string;
  apiBase: string;
  resolvePath: (p: string) => string;
}

/** 整体配置对象类型（全字段有类型） */
export interface Config {
  env: string;
  port: number;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    waitForConnections: boolean;
    connectionLimit: number;
    dateStrings: boolean;
  };
  jwt: { secret: string; expiresIn: string };
  serviceRate: number;
  restrict: { minRating: number; window: number; days: number };
  pay: PayConfig;
  validatePayConfig: () => void;
  subscribe: SubscribeConfig;
  validateSubscribeConfig: () => void;
}

/** 微信订阅消息配置（见 docs/API.md「订阅消息推送」） */
export interface SubscribeConfig {
  mock: boolean;
  /** 通知 type → 订阅消息模板 ID（空/占位 = 该类型不推微信，仅站内信） */
  templates: Record<string, string>;
}

/** 微信支付占位值（与 docs/API.md「支付模式」表格一致），真实模式下禁止保留占位 */
export const WXPAY_PLACEHOLDERS: Record<string, string> = {
  WXPAY_APPID: 'wx0000000000000000',
  WXPAY_MCHID: '1900000000',
  WXPAY_SERIAL_NO: 'MOCK_SERIAL_NO',
  WXPAY_PRIVATE_KEY: './certs/mock_key.pem',
  WXPAY_API_V3_KEY: '0123456789abcdef0123456789abcdef',
  WXPAY_NOTIFY_URL: 'https://your.domain/api/pay/notify',
  WXPAY_PLATFORM_CERT: './certs/mock_platform.pem',
  WXPAY_APP_SECRET: '00000000000000000000000000000000',
};

/** 订阅消息模板占位值（与 docs/API.md「订阅消息推送」表格一致），真实模式下禁止保留占位 */
export const WXSUBSCRIBE_PLACEHOLDERS: Record<string, string> = {
  WX_TMPL_DISPATCH: 'TEMPLATE_ID_PLACEHOLDER',
  WX_TMPL_FINISH: 'TEMPLATE_ID_PLACEHOLDER',
  WX_TMPL_REFUND: 'TEMPLATE_ID_PLACEHOLDER',
  WX_TMPL_CANCEL: 'TEMPLATE_ID_PLACEHOLDER',
  WX_TMPL_START_REMIND: 'TEMPLATE_ID_PLACEHOLDER',
};

/** 相对路径按 server 根目录解析（.env 里写 ./certs/xxx.pem 即 server/certs/xxx.pem） */
function resolveServerPath(p: string): string {
  if (!p) return '';
  if (path.isAbsolute(p)) return p;
  return path.resolve(__dirname, '../..', p);
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 7010),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'jiepai_platform',
    // 演示用：连接池 + 超时
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true, // DATETIME 统一返回字符串，避免时区二次转换
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'jiepai-dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES || '7d',
  },
  // 平台抽成比例（完工时按结算金额计提服务费）
  serviceRate: 0.1,
  // 低分惩罚（docs/DESIGN-phase2.md §4.3）：近 N 次被评均分低于阈值 → 限制 N 天（均可 env 覆盖）
  restrict: {
    minRating: Number(process.env.RESTRICT_MIN_RATING || 3.0), // 触发阈值均分
    window: Number(process.env.RESTRICT_WINDOW || 5), // 近 N 次有效被评
    days: Number(process.env.RESTRICT_DAYS || 7), // 限制天数
  },
  // 微信支付（见 docs/API.md「支付模式」）：占位配置 + mock 开关，填真实值即可切真通道
  pay: {
    mock: String(process.env.PAY_MOCK ?? '1').trim() !== '0', // 1 模拟支付（默认）；0 真实微信支付
    strict: String(process.env.PAY_STRICT ?? '0').trim() === '1', // 1 时未支付订单禁止派单/抢单
    appid: process.env.WXPAY_APPID || '',
    mchid: process.env.WXPAY_MCHID || '',
    serialNo: process.env.WXPAY_SERIAL_NO || '',
    privateKey: process.env.WXPAY_PRIVATE_KEY || '', // 商户 API 私钥文件路径（或直接内联 PEM）
    apiV3Key: process.env.WXPAY_API_V3_KEY || '',
    notifyUrl: process.env.WXPAY_NOTIFY_URL || '',
    platformCert: process.env.WXPAY_PLATFORM_CERT || '', // 微信平台证书路径（回调验签）
    clientCert: process.env.WXPAY_CLIENT_CERT || '', // 可选：商户证书（mTLS 退款用），默认取私钥同目录 apiclient_cert.pem
    appSecret: process.env.WXPAY_APP_SECRET || '',
    apiBase: 'https://api.mch.weixin.qq.com',
    resolvePath: resolveServerPath,
  },
  validatePayConfig,
  // 微信订阅消息（见 docs/API.md「订阅消息推送」）：SUBSCRIBE_MOCK 开关 + 通知 type → 模板 ID
  subscribe: {
    mock: String(process.env.SUBSCRIBE_MOCK ?? '1').trim() !== '0', // 1 MOCK 推送打日志（默认）；0 真实下发
    templates: {
      dispatch: process.env.WX_TMPL_DISPATCH || '',
      finish: process.env.WX_TMPL_FINISH || '',
      refund: process.env.WX_TMPL_REFUND || '',
      cancel: process.env.WX_TMPL_CANCEL || '',
      start_remind: process.env.WX_TMPL_START_REMIND || '',
    },
  },
  validateSubscribeConfig,
};

/**
 * 启动校验：PAY_MOCK=0（真实模式）时，任一 WXPAY_* 缺失 / 仍是占位值 / 证书文件不存在 → 直接 throw 中文错误。
 * mock 模式（PAY_MOCK=1）不做任何校验，零资质可跑通全流程。
 */
function validatePayConfig(): void {
  if (config.pay.mock) return;
  const problems: string[] = [];
  for (const [key, placeholder] of Object.entries(WXPAY_PLACEHOLDERS)) {
    const v = (process.env[key] || '').trim();
    if (!v) problems.push(`${key} 未配置`);
    else if (v === placeholder) problems.push(`${key} 仍是占位值（${placeholder}）`);
  }
  // 证书文件必须真实存在（路径已通过占位检查）
  const needFiles: Array<[string, string]> = [
    ['WXPAY_PRIVATE_KEY', config.pay.privateKey],
    ['WXPAY_PLATFORM_CERT', config.pay.platformCert],
  ];
  for (const [key, p] of needFiles) {
    if (!p || p === WXPAY_PLACEHOLDERS[key]) continue;
    if (!fs.existsSync(resolveServerPath(p))) {
      problems.push(`${key} 指向的文件不存在：${resolveServerPath(p)}`);
    }
  }
  if (problems.length) {
    throw new Error(
      `[支付配置] PAY_MOCK=0 真实微信支付模式下配置不完整，启动终止：\n  - ${problems.join('\n  - ')}\n`
      + '请在 server/.env 中填入真实 WXPAY_* 配置（参考 docs/API.md「支付模式」表格），或改回 PAY_MOCK=1 使用模拟支付。',
    );
  }
}

export { validatePayConfig };

/**
 * 启动校验：SUBSCRIBE_MOCK=0（真实推送）时：
 *  - WXPAY_APPID / WXPAY_APP_SECRET 必须真实（订阅消息与 code2session 共用小程序凭证）
 *  - 至少配置 1 个模板 ID，且已配置的不能是占位值
 * mock 模式（SUBSCRIBE_MOCK=1，默认）不做任何校验。
 */
function validateSubscribeConfig(): void {
  if (config.subscribe.mock) return;
  const problems: string[] = [];
  for (const key of ['WXPAY_APPID', 'WXPAY_APP_SECRET']) {
    const v = (process.env[key] || '').trim();
    if (!v) problems.push(`${key} 未配置（订阅消息与 code2session 共用小程序凭证）`);
    else if (v === WXPAY_PLACEHOLDERS[key]) problems.push(`${key} 仍是占位值（${WXPAY_PLACEHOLDERS[key]}）`);
  }
  let realCount = 0;
  for (const [key, placeholder] of Object.entries(WXSUBSCRIBE_PLACEHOLDERS)) {
    const v = (process.env[key] || '').trim();
    if (!v) continue; // 未配置的类型自动降级为仅站内信，不算错误
    if (v === placeholder) problems.push(`${key} 仍是占位值（${placeholder}）`);
    else realCount += 1;
  }
  if (realCount === 0) problems.push('未配置任何真实模板 ID（至少填 1 个 WX_TMPL_*）');
  if (problems.length) {
    throw new Error(
      `[订阅消息配置] SUBSCRIBE_MOCK=0 真实推送模式下配置不完整，启动终止：\n  - ${problems.join('\n  - ')}\n`
      + '请在 server/.env 填入 mp 后台「订阅消息」选用的模板 ID（参考 docs/API.md「订阅消息推送」表格），或改回 SUBSCRIBE_MOCK=1。',
    );
  }
}

export { validateSubscribeConfig };
export default config;
