/**
 * 微信支付 APIv3 SDK（纯 Node 内置实现：crypto + fetch + https，零新增 npm 依赖）
 * 只负责「签名 / 验签 / 加解密 / HTTP 调用」，不依赖任何业务代码。
 *
 * 涉及的微信支付规范：
 *  1. 商户请求签名 Authorization：WECHATPAY2-SHA256-RSA2048（私钥 RSA-SHA256）
 *  2. 小程序拉起支付参数签名 paySign：appid/nonceStr/package/timeStamp 四行拼串，signType=RSA
 *  3. 回调验签 Wechatpay-Signature：微信平台证书公钥验签，时间戳 5 分钟容差
 *  4. 回调解密 resource：AES-256-GCM（APIv3 密钥为密钥，nonce 为 IV，末 16 字节为 authTag）
 *  5. 退款接口需双向 TLS（mTLS）：https.request 挂商户证书 key/cert
 */
import crypto from 'crypto';
import https from 'https';
import type { RequestOptions } from 'https';
import fs from 'fs';
import path from 'path';
import type { IncomingHttpHeaders } from 'http';
import config from '../../config/config.default';

const payCfg = () => config.pay; // 惰性取配置，便于测试时切换环境变量

/** 微信接口返回（宽松：允许任意字段） */
export interface WxApiResponse {
  [key: string]: any;
}

/** 回调 resource 解密后的明文（含 out_trade_no / transaction_id / trade_state 等） */
export interface WxNotifyData {
  out_trade_no: string;
  transaction_id?: string;
  trade_state: string;
  [key: string]: any;
}

/* ----------------------------- 密钥 / 证书读取 ----------------------------- */

/** 读 PEM 文件；若传入值本身是 PEM 文本（含 BEGIN）则直接返回 */
function readPem(value: string, label: string): string {
  if (!value) throw new Error(`[微信支付] ${label} 未配置`);
  if (value.includes('-----BEGIN')) return value;
  const file = config.pay.resolvePath(value);
  if (!fs.existsSync(file)) throw new Error(`[微信支付] ${label} 文件不存在：${file}`);
  return fs.readFileSync(file, 'utf8');
}

/** 商户 API 私钥（签名用） */
export function loadMerchantKey(): string {
  return readPem(payCfg().privateKey, '商户 API 私钥（WXPAY_PRIVATE_KEY）');
}

/** 商户 API 证书 PEM（退款接口 mTLS 客户端证书），默认取私钥同目录的 apiclient_cert.pem */
export function loadMerchantCert(): string {
  const explicit = payCfg().clientCert;
  if (explicit) return readPem(explicit, '商户证书（WXPAY_CLIENT_CERT）');
  const keyVal = payCfg().privateKey;
  if (!keyVal || keyVal.includes('-----BEGIN')) {
    throw new Error('[微信支付] 未找到商户证书：请配置 WXPAY_CLIENT_CERT 指向 apiclient_cert.pem');
  }
  const keyFile = config.pay.resolvePath(keyVal);
  const dir = path.dirname(keyFile);
  const base = path.basename(keyFile);
  // 微信商户平台下载的证书对：apiclient_key.pem + apiclient_cert.pem（也兼容 xxx_key.pem → xxx_cert.pem）
  const candidates = base.endsWith('_key.pem')
    ? [path.join(dir, base.replace(/_key\.pem$/, '_cert.pem')), path.join(dir, 'apiclient_cert.pem')]
    : [path.join(dir, 'apiclient_cert.pem')];
  const found = candidates.find((f) => fs.existsSync(f));
  if (!found) {
    throw new Error(`[微信支付] 未找到商户证书文件（mTLS 退款必需）：${candidates.join(' 或 ')}`);
  }
  return fs.readFileSync(found, 'utf8');
}

/** 微信平台证书 PEM（回调验签用） */
export function loadPlatformCert(): string {
  return readPem(payCfg().platformCert, '微信平台证书（WXPAY_PLATFORM_CERT）');
}

/* ----------------------------- 随机串 ----------------------------- */

export function randomNonce(len = 32): string {
  return crypto.randomBytes(Math.ceil((len * 3) / 4)).toString('base64').replace(/[+/=]/g, '').slice(0, len);
}

/** RSA-SHA256 签名 → Base64（微信支付要求 PKCS1 v1.5 填充） */
function rsaSignBase64(message: string, keyPem: string): string {
  return crypto
    .sign('sha256', Buffer.from(message, 'utf8'), { key: keyPem, padding: crypto.constants.RSA_PKCS1_PADDING })
    .toString('base64');
}

/* ----------------------------- 1. 商户请求签名 ----------------------------- */

export interface AuthSignOptions {
  nonceStr?: string;
  privateKey?: string;
  mchid?: string;
  serialNo?: string;
}

/**
 * 构造 Authorization 请求头（APIv3 商户请求签名）
 * 签名串：METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n （body 为空则该段为空串，签名串仍以 \n 结尾）
 * @param method  HTTP 方法，如 POST / GET
 * @param url     URL（含查询串，不含域名），如 /v3/pay/transactions/jsapi
 * @param body    请求体原文（JSON 字符串），GET 传 ''
 * @returns `WECHATPAY2-SHA256-RSA2048 mchid="..",nonce_str="..",signature="..",timestamp="..",serial_no=".."`
 */
export function signWechatpayAuth(method: string, url: string, body: string, opts: AuthSignOptions = {}): string {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = opts.nonceStr || randomNonce();
  const message = `${method.toUpperCase()}\n${url}\n${timestamp}\n${nonceStr}\n${body || ''}\n`;
  const signature = rsaSignBase64(message, opts.privateKey || loadMerchantKey());
  const mchid = opts.mchid || payCfg().mchid;
  const serialNo = opts.serialNo || payCfg().serialNo;
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
}

/* ----------------------------- 2. 小程序拉起支付参数签名 ----------------------------- */

export interface PaySignParams {
  appid: string;
  nonceStr: string;
  package: string;
  timeStamp: string;
}

/**
 * 生成 wx.requestPayment 的 paySign
 * 签名串：appid\nnonceStr\npackage\ntimeStamp\n （四行各以 \n 结尾，末尾同样有 \n）
 * signType 固定 RSA
 * @returns Base64 签名
 */
export function signPayParams({ appid, nonceStr, package: pkg, timeStamp }: PaySignParams): string {
  const message = `${appid}\n${nonceStr}\n${pkg}\n${timeStamp}\n`;
  return rsaSignBase64(message, loadMerchantKey());
}

/* ----------------------------- 3. 回调验签 ----------------------------- */

/** 兼容大小写不同的 header key（Node 会把请求头转小写） */
function headerValue(headers: IncomingHttpHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  return (headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]) as string | undefined;
}

/**
 * 校验微信支付回调签名
 * 签名串：timestamp\nnonce\nbody\n ，用微信平台证书公钥做 RSA-SHA256 验签；
 * 时间戳与服务器时间差超过 5 分钟直接判失败（防重放）
 * @returns boolean
 */
export function verifyNotify(headers: IncomingHttpHeaders, rawBody: string | Buffer, platformCertPem?: string): boolean {
  const signature = headerValue(headers, 'Wechatpay-Signature');
  const timestamp = headerValue(headers, 'Wechatpay-Timestamp');
  const nonce = headerValue(headers, 'Wechatpay-Nonce');
  if (!signature || !timestamp || !nonce) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const certPem = platformCertPem || loadPlatformCert();
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(message, 'utf8'),
      { key: certPem, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(signature, 'base64'),
    );
  } catch (e) {
    return false;
  }
}

/* ----------------------------- 4. 回调解密（AES-256-GCM） ----------------------------- */

/**
 * 解密回调 resource：ciphertext 为 Base64，前段为密文、末 16 字节为 authTag；nonce 作 IV；
 * associated_data 通常为 "aead"（微信也允许为空）
 * @returns JSON 明文对象（含 out_trade_no / transaction_id / trade_state 等）
 */
export function decryptResource(cipherBase64: string, ivBase64: string, apiv3Key: string, associatedData = ''): WxNotifyData {
  const key = apiv3Key || payCfg().apiV3Key;
  if (!key || Buffer.byteLength(key, 'utf8') !== 32) {
    throw new Error('[微信支付] APIv3 密钥（WXPAY_API_V3_KEY）必须是 32 字节');
  }
  const data = Buffer.from(cipherBase64, 'base64');
  if (data.length < 17) throw new Error('[微信支付] 回调密文长度非法');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(0, data.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), iv);
  decipher.setAuthTag(authTag);
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

/* ----------------------------- 5. HTTP 调用 ----------------------------- */

/** 解析微信返回：非 2xx 或含 errcode 都视为失败，抛出带中文说明的 Error */
function parseWechatResponse(status: number, text: string): WxApiResponse {
  let data: WxApiResponse | null = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`[微信支付] 响应解析失败（HTTP ${status}）：${text.slice(0, 200)}`);
  }
  if (status < 200 || status >= 300 || (data && data.errcode)) {
    const msg = (data && (data.message || data.errmsg)) || text.slice(0, 200);
    const code = (data && (data.code || data.errcode)) || status;
    throw new Error(`[微信支付] 接口调用失败（${code}）：${msg}`);
  }
  return data as WxApiResponse;
}

/**
 * POST JSON（普通 v3 接口，如 JSAPI 下单），Node20 全局 fetch + Authorization 头
 * @returns 微信返回的 JSON
 */
export async function postJson(apiPath: string, payload: unknown): Promise<WxApiResponse> {
  const body = JSON.stringify(payload);
  const res = await fetch(`${payCfg().apiBase}${apiPath}`, {
    method: 'POST',
    headers: {
      Authorization: signWechatpayAuth('POST', apiPath, body),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'jiepai-platform/1.0',
    },
    body,
  });
  return parseWechatResponse(res.status, await res.text());
}

/**
 * POST JSON + 双向 TLS（mTLS）：退款等敏感接口必须携带商户证书
 * 用 https.request 显式挂 key/cert（私钥与证书 PEM 直接读文件内容）
 * @returns 微信返回的 JSON
 */
export function postJsonWithCert(apiPath: string, payload: unknown): Promise<WxApiResponse> {
  const body = JSON.stringify(payload);
  const base = new URL(payCfg().apiBase);
  const options: RequestOptions = {
    hostname: base.hostname,
    port: base.port || 443,
    path: apiPath,
    method: 'POST',
    key: loadMerchantKey(), // 商户 API 私钥（mTLS 客户端私钥）
    cert: loadMerchantCert(), // 商户 API 证书（mTLS 客户端证书）
    headers: {
      Authorization: signWechatpayAuth('POST', apiPath, body),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'jiepai-platform/1.0',
    },
  };
  return new Promise<WxApiResponse>((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(parseWechatResponse(res.statusCode as number, Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', (err) => reject(new Error(`[微信支付] mTLS 请求失败：${err.message}`)));
    req.setTimeout(15000, () => {
      req.destroy(new Error('[微信支付] mTLS 请求超时'));
    });
    req.write(body);
    req.end();
  });
}

/* ----------------------------- 6. code2session 换 openid ----------------------------- */

/**
 * 小程序 wx.login 的 code → openid（JSAPI 下单必需）
 * GET https://api.weixin.qq.com/sns/jscode2session
 * @returns {openid, session_key}
 */
export async function code2session(code: string): Promise<{ openid: string; session_key?: string }> {
  const { appid, appSecret } = payCfg();
  if (!appid || !appSecret) throw new Error('[微信支付] 未配置 WXPAY_APPID / WXPAY_APP_SECRET');
  const url = 'https://api.weixin.qq.com/sns/jscode2session'
    + `?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(appSecret)}`
    + `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const data = (await res.json()) as { errcode?: number; errmsg?: string; openid?: string; session_key?: string };
  if (data.errcode) throw new Error(`code2session 失败（${data.errcode}）：${data.errmsg || '未知错误'}`);
  if (!data.openid) throw new Error('code2session 未返回 openid');
  return { openid: data.openid, session_key: data.session_key };
}
