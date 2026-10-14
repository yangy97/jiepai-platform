# jiepai-server · 接派服务端

Express + MySQL（mysql2）+ JWT，为**微信小程序端**与 **Web 管理端**提供统一 REST API。

## 快速开始

```bash
cd server
nvm use                      # 读取根目录 .nvmrc → Node 20
npm install
cp .env.example .env         # 本地 MySQL 账号密码按需调整
npm run db:init              # 建库建表（幂等）
npm run db:seed              # 灌入演示数据
npm run dev                  # 启动 http://127.0.0.1:7010
```

一键重置数据库：`npm run db:reset`（删库 → 建表 → 种子数据）。

## 目录结构

```
server/
├── .env / .env.example        # 端口、MySQL、JWT 密钥
├── src/
│   ├── server.js              # 入口：探活数据库后监听端口
│   ├── app.js                 # Express 装配（cors/json/日志/路由/错误处理）
│   ├── config/config.default.js
│   ├── db/
│   │   ├── schema.sql         # 7 张表结构（users/categories/workers/orders/order_logs/wallets/wallet_logs）
│   │   ├── pool.js            # 连接池、query/one/transaction
│   │   ├── init.js            # 建库建表（--reset 删库重建）
│   │   └── seed.js            # 种子数据（--force 重灌）
│   ├── app/
│   │   ├── router.js          # 路由集中注册 + 分级鉴权
│   │   ├── middleware/auth.js # attachUser / authRequired / requireRole
│   │   ├── controller/        # 薄层：解析入参 → 调 service → 统一响应
│   │   └── service/           # 业务与 SQL（order/admin/worker/wallet/auth）
│   └── util/                  # 统一响应、JWT、订单号、express 辅助
└── package.json
```

## 分层约定（参照 oa_template）

| 层 | 职责 | 例 |
|---|---|---|
| `app/router.js` | 集中注册 + 鉴权分级 | 对应 `oa_template/server/app/router.ts` |
| `app/controller/*.js` | 参数校验、调用 service、`ok(res, data)` | 对应 `oa_template/server/app/controller/*.ts` |
| `app/service/*.js` | 业务规则 + SQL，抛 `BizError` | 模板未涉及，按 Egg 惯例补齐 |
| `util/response.js` | 统一 `{code,message,data}`、错误处理中间件 | 模板未涉及，自行补充 |

## 统一响应

```jsonc
// 成功
{ "code": 0, "message": "ok", "data": { } }
// 失败（HTTP 状态码同步）
{ "code": 409, "message": "该订单已被派给其他师傅", "data": null }
```

错误码：`400` 参数错误 · `401` 未登录 · `403` 无权限 · `404` 不存在 · `409` 状态冲突 · `500` 服务端。

## 接口

完整清单见 [`../docs/API.md`](../docs/API.md)。核心状态机：

```
pending(待接单) → dispatched(已派单) → accepted(已接单) → working(服务中) → finished(待确认) → completed(已完成)
                                    任意非终态 ───────────────────────────────────────────────→ cancelled(已取消)
```

抢单/派单用 `UPDATE ... WHERE status IN (...)` 乐观锁（affectedRows=0 → 409），天然防并发重复接单。
结算在 `confirm` 事务内完成：`入账 = price - service_fee`（平台抽成 10%）→ 写 `wallets` + `wallet_logs` + 师傅完成单量 +1。

## 自测

```bash
# 需先启动服务
npm run test:api        # 项目根目录执行，43 项断言，默认重置数据库
KEEP_DB=1 npm run test:api   # 不重置
```
