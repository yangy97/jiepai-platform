/**
 * 全局配置
 * BASE_URL：后端接口基地址（与 docs/API.md 一致）
 * SUBSCRIBE_TMPL_IDS：微信订阅消息模板 ID（mp.weixin.qq.com 后台「订阅消息」选用后填入，
 *   须与服务端 server/.env 的 WX_TMPL_* 保持一致）
 *   - 空数组 = 不弹授权窗（演示默认，零资质可跑）
 *   - ≥1 个时：登录/注册按钮与「我的 → 消息中心」入口点击会弹订阅授权
 *     （一次性订阅：每授权 1 次 = 每个模板可收 1 条推送）
 */
const BASE_URL = 'http://127.0.0.1:7010';
const SUBSCRIBE_TMPL_IDS = []; // 例：['AbC1x9K...真实模板ID1', 'XyZ2p7M...真实模板ID2']

module.exports = { BASE_URL, SUBSCRIBE_TMPL_IDS };
