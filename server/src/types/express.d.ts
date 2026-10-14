/**
 * Express / Node 请求对象的全局类型扩展（声明合并）
 * rawBody：app.ts 中 express.json({ verify }) 缓存的原始请求体，
 *          微信支付回调 /api/pay/notify 验签需要原始 body（见 pay.service.handleNotify）。
 * 挂在 http.IncomingMessage 上，Express.Request 继承后即可直接读写，无需强转。
 */
declare module 'http' {
  interface IncomingMessage {
    /** 原始请求体（Buffer 缓存，验签用） */
    rawBody?: Buffer;
  }
}

export {};
