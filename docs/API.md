# 接派 · 上门服务接单派单平台 —— 接口契约（三端共享）

> 小程序（miniapp）、Web 管理端（admin）、后端（server）三端均以此文档为准。
> 后端基地址：`http://127.0.0.1:7010`；管理端 dev 通过 Vite `/api` 代理转发；小程序在 `miniapp/config.js` 配置 `BASE_URL`。

## 一、通用约定

- 所有接口前缀 `/api`，请求体 `application/json`。
- 统一响应体：

```jsonc
{ "code": 0, "message": "ok", "data": {} }
```

- `code === 0` 成功；非 0 失败。常见错误码：`400` 参数错误、`401` 未登录/token 失效、`403` 无权限、`404` 不存在、`409` 状态冲突（如订单被抢）、`500` 服务端错误。HTTP 状态码与之对应。
- 鉴权：登录成功返回 `token`（JWT，有效期 7 天），后续请求带请求头：

```
Authorization: Bearer <token>
```

- 列表类接口统一入参 `page`（默认 1）、`page_size`（默认 10），统一出参：

```jsonc
{ "code": 0, "message": "ok", "data": { "list": [], "total": 0, "page": 1, "page_size": 10 } }
```

## 二、枚举

### 订单状态 `order.status`

| 值 | 中文 | 说明 | 可执行操作 |
|---|---|---|---|
| `pending` | 待接单 | 客户下单，等待师傅抢单或运营派单 | 师傅：抢单；运营：派单；客户：取消 |
| `dispatched` | 已派单 | 运营已指定师傅，待师傅接单 | 师傅：接单/拒单；运营：改派、取消 |
| `accepted` | 已接单 | 师傅已确认，等待上门 | 师傅：开始服务；客户/运营：取消 |
| `working` | 服务中 | 师傅已上门开工 | 师傅：提交完工 |
| `finished` | 待确认 | 师傅提交完工与金额，等客户确认 | 客户/运营：确认完成；师傅：撤回 |
| `aborted` | 中途结束 | 服务已开始但提前终止，待客户确认实收 | 客户/运营：确认结算（→ completed） |
| `completed` | 已完成 | 已结算（师傅钱包入账） | 客户：评价；师傅：评价客户 |
| `cancelled` | 已取消 | 终态 | — |

状态流转：`pending → (dispatched) → accepted → working → finished → completed`，任意非终态可 → `cancelled`；**新增分支** `working → aborted → completed`（中途退出，按进度结算）。

### 其它枚举

- 用户角色 `user.role`：`admin` 运营后台 | `customer` 客户 | `worker` 师傅
- 师傅认证 `worker.status`：`pending` 待审核 | `approved` 已认证 | `rejected` 已驳回 | `disabled` 已停用
- 钱包流水 `type`：`income` 收入 | `withdraw` 提现 | `refund` 退款
- 支付状态 `order.pay_status`：`unpaid` 待支付 | `paid` 已支付 | `refunded` 已退款
- 退款政策 `order.refund_policy`（**下单时锁定，不可修改**）：`flexible` 支持中途退款（默认）| `strict` 不可中途退款
- 计费方式 `order.billing_type`：`fixed` 一口价（默认）| `hourly` 时薪（下单填 `hourly_price`）
- 受限状态 `restricted`：`0` 正常 | `1` 受限（近 5 单均分 < 3.0 自动限制 7 天，期间禁止接单/派单/下单）
- 评价维度：客户评师傅 `rating` 总分 + `skill` 技术 + `attitude` 态度 + `punctual` 准时（各 1-5）+ `tags` 快捷标签；师傅回评客户 `worker_rating` 总分 + `tags` + `comment`

**退款规则（服务端强制执行）**：

| 时刻 | 政策 | 客户取消行为 |
|---|---|---|
| 开工前（`pending/dispatched/accepted`，含未到预约时间） | 任意 | `cancelled` + **已支付自动全额退款** |
| 开工后（`working`） | `flexible` | `cancelled` + 按进度退款：`实收 = 时薪 × ceil(已服务分钟 ÷ 30) × 0.5`（hourly）或发起方填写（fixed），`refund = 已付 − 实收` |
| 开工后（`working`） | `strict` | **`409 按下单约定不支持中途退款`**（仅运营可手动退款） |
| 任意时刻 | 运营手动退款 | `POST /api/admin/orders/:id/refund`（带 `{ amount?, reason? }`，留审计日志） |

### 支付模式（微信支付，真实代码 + 占位配置）

服务端实现了**完整的微信支付 JSAPI v3 真实流程**（统一下单 / 拉起参数签名 / 回调验签解密 / 退款），敏感参数用 `.env` 占位，**把真实值填进去即可切真通道**，不需要改代码：

| 环境变量 | 说明 | 占位示例 |
|---|---|---|
| `PAY_MOCK` | `1` 走模拟支付（默认，Demo 零资质可跑通全流程）；`0` 走真实微信支付 | `1` |
| `WXPAY_APPID` | 小程序 appid | `wx0000000000000000` |
| `WXPAY_MCHID` | 微信支付商户号 | `1900000000` |
| `WXPAY_SERIAL_NO` | 商户 API 证书序列号 | `MOCK_SERIAL_NO` |
| `WXPAY_PRIVATE_KEY` | 商户 API 私钥文件路径（apiclient_key.pem） | `./certs/mock_key.pem` |
| `WXPAY_API_V3_KEY` | APIv3 密钥（32 字节） | `0123456789abcdef0123456789abcdef` |
| `WXPAY_NOTIFY_URL` | 支付回调地址（需公网可达） | `https://your.domain/api/pay/notify` |
| `WXPAY_PLATFORM_CERT` | 微信平台证书路径（回调验签用） | `./certs/mock_platform.pem` |
| `WXPAY_APP_SECRET` | 小程序 AppSecret（`wx.login` code2session 换 openid，JSAPI 下单必需） | `00000000000000000000000000000000` |

- **mock 模式（`PAY_MOCK=1`）**：小程序仍走「去支付 → 拉起支付」的完整交互，但服务端直接把订单置为 `paid`，不产生真实交易；`WXPAY_*` 全部不校验。
- **真实模式（`PAY_MOCK=0`）**：服务端按 v3 规范签名请求微信接口、验证回调签名并解密报文；`WXPAY_*` 任一缺失启动即报错。
- 切换真通道 = 填 `.env` + `PAY_MOCK=0` + 配好回调 URL，三步，不改代码。

### 订阅消息推送（微信小程序订阅消息，真实代码 + 占位配置）

通知默认是**站内信**（`notifications` 表 + 小程序消息中心）。服务端实现了**微信订阅消息真实下发**（`stable_token` 取 access_token → `wxa/msg/subscribe/send`），失败静默降级回站内信，绝不阻断业务；小程序端在登录/注册/「消息中心」入口点击时调 `wx.requestSubscribeMessage` 弹授权。

| 环境变量 | 说明 | 占位示例 |
|---|---|---|
| `SUBSCRIBE_MOCK` | `1` MOCK 推送只打日志（默认，Demo 零资质可跑）；`0` 真实下发微信 | `1` |
| `WX_TMPL_DISPATCH` | 新订单派单通知（师傅）模板 ID | `TEMPLATE_ID_PLACEHOLDER` |
| `WX_TMPL_FINISH` | 完工待确认通知（客户）模板 ID | `TEMPLATE_ID_PLACEHOLDER` |
| `WX_TMPL_REFUND` | 退款到账通知（客户）模板 ID | `TEMPLATE_ID_PLACEHOLDER` |
| `WX_TMPL_CANCEL` | 订单取消通知（双方）模板 ID | `TEMPLATE_ID_PLACEHOLDER` |
| `WX_TMPL_START_REMIND` | 上门时间提醒（师傅）模板 ID | `TEMPLATE_ID_PLACEHOLDER` |

- **一次性订阅语义**（普通类目小程序仅此一种）：用户每点「允许」1 次 = 每个模板可推 1 条；发送时未授权返回 `43101` → 静默跳过（站内信已兜底）。授权弹窗必须由**用户点击触发**，故挂在登录/注册按钮与「消息中心」入口的 tap 回调里。
- **启用真实推送步骤**：mp.weixin.qq.com 后台「订阅消息」选用模板并过审 → 真实模板 ID 同时填 `server/.env` 的 `WX_TMPL_*` 与 `miniapp/config.js` 的 `SUBSCRIBE_TMPL_IDS`（两处一致）→ `SUBSCRIBE_MOCK=0`。模板字段 key 各异，调整点在服务端 `constant/notification.constant.ts` 的 `SUBSCRIBE_TEMPLATE_FIELDS`。
- **openid 依赖**：登录成功后小程序静默 `wx.login` → `POST /api/auth/wx-code` 换取并存 `users.openid`（与支付 `code2session` 共用）；为空则跳过推送。凭证复用 `WXPAY_APPID` / `WXPAY_APP_SECRET`，真实模式启动校验（`validateSubscribeConfig`）缺失即报错。
- **access_token** 进程内缓存（7200s，提前 5 分钟刷新）；多实例部署需换集中缓存（如 Redis）。

## 三、接口清单

### 1. 认证 `auth`

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/auth/sms-code` | 无 | `{ phone }` → `{ code: "123456" }`（演示固定验证码） |
| POST | `/api/auth/login` | 无 | `{ phone, password }` 或 `{ phone, code }` → `{ token, user }` |
| POST | `/api/auth/register` | 无 | `{ phone, code, password, name, role: "customer"\|"worker" }` → `{ token, user }` |
| GET | `/api/auth/me` | 需登录 | → `{ user }` 当前登录用户 |
| POST | `/api/auth/wx-code` | 需登录 | `{ code }`（wx.login code）→ `{ ok }`，绑定 openid 供订阅消息推送；mock 模式失败返回 `{ ok:false, mock:true }` |

`user` 结构（所有出现处一致）：

```jsonc
{ "id": 1, "phone": "13800000001", "name": "张三", "avatar": "", "role": "customer" }
```

### 2. 首页 / 类目（小程序）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/home` | 可选 | → `{ banners: [{id,title,image}], categories: [...], notice: "..." }` |
| GET | `/api/categories` | 可选 | → `{ list: Category[] }` |

`Category`：`{ id, name, icon, min_price, unit, description, status }`

> **类目是动态的**：管理端「服务类目」新增/上架后，小程序首页与下单页立即可见（同一张表）。
> 订单支持**自定义类型**（见下单接口 `custom_category`），不受固定类目限制。

### 2.1 头像上传（微信头像昵称能力）

微信自 2022-10 起不再提供 `getUserProfile` 静默获取头像昵称，官方方案是**头像昵称填写能力**：
小程序用 `<button open-type="chooseAvatar" @chooseavatar>` 拿到头像临时路径 → 读文件上传到本接口 → 落库。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/user/avatar` | 需登录 | `multipart/form-data`，字段名 `file`（png/jpg/gif/webp，≤2MB）→ `{ user: { id, phone, name, avatar, role } }` |

- 头像文件落盘 `server/uploads/avatar/<时间戳><随机>.<ext>`，由服务端静态托管在 `GET /uploads/avatar/xxx`。
- `users.avatar` 存的是**以 `/` 开头的相对路径**（如 `/uploads/avatar/1712.png`），小程序端拼 `BASE_URL + avatar`，管理端走 Vite 代理直接 `avatar` 原样拼接。
- 非法类型/超 2MB → `400`；未登录 → `401`。

### 2.2 下单（含自定义服务类型）

`POST /api/orders` 入参在原基础上增加：

| 字段 | 类型 | 说明 |
|---|---|---|
| `category_id` | number \| 可选 | 传固定类目时必填 |
| `custom_category` | string \| 可选 | **自定义服务类型**（≤30 字）。与 `category_id` 二选一；两者都传以 `custom_category` 为准 |
| `lat` / `lng` | number \| 可选 | 地图选址返回的坐标（小程序 `wx.chooseLocation` / 管理端地图选点） |

规则：`category_id` 与 `custom_category` 至少一个；都为空 → `400 请选择服务类型或填写自定义类型`。
返回的 `order` 中：
- `category_name`：固定类目返回类目名；自定义返回 `custom_category` 的值
- `custom_category`：自定义时为该值，否则 `""`
- `is_custom`：布尔，自定义类型为 `true`（管理端据此打「自定义」标签）
- `category_id`：自定义时为 `null`


### 3. 订单（小程序端，客户 + 师傅）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/orders` | customer | `{ category_id/custom_category, title, description, address, lat?, lng?, expect_at?, budget, refund_policy?, billing_type?, hourly_price? }` → `{ order }`（`refund_policy`/`billing_type` 下单后不可改） |
| GET | `/api/orders` | worker | 接单大厅：`?status=pending&page=` → 分页列表（只返回无 `worker_id` 的待接单）；**受限师傅 403** |
| GET | `/api/orders/mine` | 需登录 | `?role=customer\|worker&status=&page=` 我的订单（按当前用户身份过滤）→ 分页列表 |
| GET | `/api/orders/:id` | 需登录 | → `{ order, customer, worker, category, logs: OrderLog[] }`（仅下单人/接单人/管理员可见） |
| POST | `/api/orders/:id/accept` | worker | 抢单（仅 `pending` 且未被派单）→ `{ order }`，被抢先返回 `409`；**受限师傅 403** |
| POST | `/api/orders/:id/start` | worker | `accepted → working` → `{ order }` |
| POST | `/api/orders/:id/finish` | worker | `working → finished`，入参 `{ price, remark? }`（`price` 为结算金额，服务费按 10% 平台抽成）→ `{ order }` |
| POST | `/api/orders/:id/abort` | 接单师傅/运营 | **中途退出**：`working → aborted`，入参 `{ reason(必填), price? }`（fixed 单 `price` 必填=实收；hourly 单服务端按时长公式自动算）→ `{ order }` |
| POST | `/api/orders/:id/confirm` | customer | `finished`/`aborted → completed`，按 `actual_fee||price` 结算入账 + 师傅统计 +1 → `{ order }` |
| POST | `/api/orders/:id/rate` | customer | `{ rating: 1-5, skill?, attitude?, punctual?(各1-5), tags?: string[](≤3), comment? }`，仅 `completed` 可评价（一次）→ `{ order }`；提交后触发低分限制检查 |
| POST | `/api/orders/:id/rate-worker` | 接单师傅 | **师傅回评客户** `{ rating: 1-5, tags?: string[](≤3), comment? }`，仅 `completed` 且一次 → `{ order }` |
| POST | `/api/orders/:id/cancel` | customer | `{ reason(必填) }`，`pending/dispatched/accepted` 可取消；**已支付自动按退款规则退款**；`working` 中取消：`flexible` 按进度退款，`strict` 返回 `409 按下单约定不支持中途退款` → `{ order }` |
| GET | `/api/notifications` | 需登录 | `?unread=1&page=&page_size=` → `{ list, total, unread_count }` |
| POST | `/api/notifications/read` | 需登录 | `{ ids?: number[] }`（缺省=全部已读）→ `{ unread_count }` |
| POST | `/api/pay/orders/:id` | customer | **发起支付**（仅下单人、`pay_status=unpaid`、订单非终态）→ 见下方 `PayParams`；重复支付 `409` |
| POST | `/api/pay/notify` | 无（验签） | **微信支付回调**（真实模式）：验签 + 解密 → 置 `paid`；幂等（已处理直接应答 SUCCESS） |
| GET | `/api/pay/orders/:id` | 需登录 | 查询支付状态 → `{ order: { id, pay_status, pay_status_text, paid_at } }` |
| POST | `/api/orders/:id/dispatch` | admin | `{ worker_id }`，`pending → dispatched` → `{ order }`（也用于改派 `dispatched`） |
| POST | `/api/orders/:id/handling` | admin | `{ action: "start"\|"finish"\|"confirm"\|"cancel", price?, reason? }` 运营代操作 → `{ order }` |
| POST | `/api/admin/orders/:id/refund` | admin | **整单退款**（仅 `paid`），入参 `{ amount?, reason? }`（缺省=全额）→ 置 `refunded` 并落 `refund_amount/refund_reason`；真实模式调微信退款 API，mock 直接落库 → `{ order }`；重复退款 `409`；`paid+completed` `409 已结算入账，请走线下退款` |

**`PayParams`（`POST /api/pay/orders/:id` 响应）**：

```jsonc
// mock 模式（PAY_MOCK=1）：服务端直接置 paid，不调微信
{ "mock": true, "paid": true, "order": { "id": 1, "pay_status": "paid", ... } }

// 真实模式（PAY_MOCK=0）：返回 wx.requestPayment 所需参数
{
  "mock": false,
  "payment": {
    "timeStamp": "1712000000",
    "nonceStr": "xxxx",
    "package": "prepay_id=wx123...",
    "signType": "RSA",
    "paySign": "Base64RSA..."
  }
}
```

> 小程序拿到 `mock:false` 后调 `wx.requestPayment(payment)`；用户取消/失败不报错（订单仍 `unpaid`，可重试）。支付成功以 `POST /api/pay/notify` 或轮询 `GET /api/pay/orders/:id` 为准。
> 业务规则：`paid` 才允许进入服务环节的**强约束只在真实模式生效**（`PAY_STRICT=1` 时未支付订单禁止派单/抢单）；mock 模式下支付是可选步骤，不阻断现有演示动线。

`Order` 结构：

```jsonc
{
  "id": 1, "order_no": "JP202610120001",
  "customer_id": 2, "worker_id": 3, "worker_name": "李师傅", "worker_phone": "138...",
  "category_id": 1, "category_name": "家电清洗", "category_icon": "🧹",
  "custom_category": "", "is_custom": false,
  "title": "油烟机清洗", "description": "...", "address": "xx路xx号", "lng": 113.9, "lat": 22.5,
  "expect_at": "2026-10-13 10:00:00", "budget": 120, "price": 0, "service_fee": 0,
  "status": "pending", "status_text": "待接单", "source": "customer",
  "pay_status": "unpaid", "pay_status_text": "待支付", "paid_at": null, "transaction_id": "",
  "refund_policy": "flexible", "refund_policy_text": "支持中途退款",
  "billing_type": "fixed", "billing_type_text": "一口价", "hourly_price": 0,
  "actual_fee": 0, "abort_reason": "", "aborted_at": null,
  "refund_amount": 0, "refund_reason": "", "refund_id": "", "refunded_at": null,
  "rating": null, "rate_comment": "", "rate_skill": null, "rate_attitude": null,
  "rate_punctual": null, "rate_tags": "",
  "worker_rating": null, "worker_rate_comment": "", "worker_rate_tags": "",
  "cancel_reason": "",
  "created_at": "2026-10-12 09:00:00", "dispatch_at": null, "accepted_at": null,
  "started_at": null, "finished_at": null, "completed_at": null
}
```

> 自定义类型订单：`category_id: null`、`category_name == custom_category`、`is_custom: true`（`category_icon` 返回 `"📋"`）。

`OrderLog`：`{ id, action, from_status, to_status, operator_name, operator_role, content, created_at }`

### 4. 师傅端

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/worker/profile` | worker | → `{ worker }`，未入驻返回 `{ worker: null }` |
| POST | `/api/worker/apply` | worker | `{ real_name, id_card, region, skills: number[], years, bio }` → 提交认证（`pending`） |
| GET | `/api/worker/stats` | worker | → `{ doing, done, today_income, month_income, rating, pending }` |
| GET | `/api/wallet` | worker | → `{ balance, income, withdrawn }` |
| GET | `/api/wallet/logs` | 需登录 | → 分页流水 `{ id, order_id, type, amount, balance_after, remark, created_at }` |

### 5. 管理端 `/api/admin/*`（全部需 `role=admin`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/dashboard` | → `{ stat: { order_count, today_count, pending_dispatch, worker_count, customer_count, done_amount, avg_rating, doing }, trend: [{date, count}], status_dist: [{status, text, count}], recent: Order[] }` |
| GET | `/api/admin/orders` | `?status=&keyword=&page=&page_size=` 分页（`keyword` 匹配订单号/标题/手机号/地址） |
| GET | `/api/admin/orders/:id` | 详情：`{ order, customer, worker, category, logs, wallet_logs }` |
| POST | `/api/admin/orders` | 代客下单 `{ customer_id, category_id, title, description, address, expect_at, budget }` |
| POST | `/api/admin/orders/:id/dispatch` | `{ worker_id }` 派单/改派 |
| POST | `/api/admin/orders/:id/handling` | `{ action, price?, reason?, remark? }` 代操作状态流转 |
| GET | `/api/admin/workers` | `?status=&keyword=&page=` 分页 |
| GET | `/api/admin/workers/:id` | 详情 `{ worker, user }` |
| POST | `/api/admin/workers/:id/audit` | `{ status: "approved"\|"rejected", remark? }` |
| PATCH | `/api/admin/workers/:id` | `{ status: "disabled"\|"enabled" }` 停用/启用 |
| GET | `/api/admin/customers` | `?keyword=&page=` 客户分页（含订单数、消费额） |
| GET | `/api/admin/categories` | 全量类目（含下架） |
| POST | `/api/admin/categories` | `{ name, icon, min_price, unit, description, sort, status }` |
| PUT | `/api/admin/categories/:id` | 同上 |
| DELETE | `/api/admin/categories/:id` | 有关联订单时返回 `409` |
| GET | `/api/admin/wallets` | 师傅钱包分页 `?keyword=` |
| GET | `/api/admin/wallet-logs` | 全平台流水分页 `?user_id=&type=` |
| GET | `/api/admin/notifications` | 全站通知分页（运营查看用，可选） |
| POST | `/api/admin/workers/:id/unrestrict` | 手动解除接单限制（恢复 `restricted=0`） |
| POST | `/api/admin/customers/:id/unrestrict` | 手动解除下单限制 |

`Notification`：`{ id, order_id, type, title, content, is_read, created_at }`，`type` 见 `DESIGN-phase2.md` §3.2 事件表。

## 四、演示账号（种子数据）

| 角色 | 手机号 | 密码 | 说明 |
|---|---|---|---|
| 运营 | 13900000000 | admin123 | 管理端登录 |
| 客户 | 13800000001 | 123456 | 小程序下单 |
| 客户 | 13800000002 | 123456 | 小程序下单 |
| 师傅 | 13800000011 | 123456 | 已认证，可抢单 |
| 师傅 | 13800000012 | 123456 | 已认证，可抢单 |
| 师傅 | 13800000013 | 123456 | 待审核，演示审核流程 |

小程序登录页提供「验证码登录（123456）」与快捷填充按钮。
