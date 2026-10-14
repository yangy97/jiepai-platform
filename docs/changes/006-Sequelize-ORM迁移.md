# [006] 引入 Sequelize ORM（模型层 + 混合查询策略）

- 日期：2026-10-13
- 状态：✅ 已完成（一阶段混合策略 + 二阶段深迁移收尾，见下「最终验收记录」）
- 涉及端：server
- 关联：[004-SQL注入安全审计](004-SQL注入安全审计.md)（注入面审计无漏洞；本迁移动机是**可维护性**而非安全）

## 需求点

- 用户决策原话：「我感觉还是可以引入 Sequelize 这样的 ORM，要不然后面按照现在的后面维护起来很头疼」。
- 现状痛点：11 个 service 里原生 SQL 与业务逻辑耦合，加字段/改查询容易漏；希望「表结构 → TS 类型 → 增删改查」收成一层。
- 硬约束：**三端接口契约零变化**，112 项断言是安全网。

## 方案（已锁定）

### 1. 模型层 `src/db/models/`（8 模型对 8 张表，映射既有 schema 不改表）

`User / Worker / ServiceCategory / Order / OrderLog / Wallet / WalletLog / Notification`

- `freezeTableName` + 显式列定义，列名/枚举/DECIMAL 与库严格对齐；
- 每模型配 TS 接口（`UserAttributes` 等）替代手写 Row 类型；
- `timestamps` 按各表实际列配置（无 `updated_at` 的关掉）；
- DECIMAL 返回行为与 mysql2 现状对齐（`formatOrder` 层不变，接口输出零变化）。

### 2. 查询策略：模型为主 + 复杂聚合兜底（务实的生产模式）

- CRUD / 条件列表 / CAS 乐观锁 / 事务 → 全走模型：
  - 乐观锁：`Order.update({...}, { where: { id, status: { [Op.in]: from } } })` 检查 `affectedCount`；
  - 事务：`sequelize.transaction()` 包裹，`transaction: t` 透传；
  - 搜索/分页：`Op.or` + `LIKE`、`findAndCountAll`。
- **≤6 处复杂聚合**（admin 订单大列表多表 JOIN + CASE WHEN FIELD 排序、状态分布统计、钱包汇总）→ `sequelize.query(sql, { replacements })` 参数化兜底——ORM 项目标准做法，兜底仍防注入。
- `db/pool.ts` 的 `query/one/transaction` 薄封装改为基于 sequelize 实现，兜底查询改动最小。

### 3. 边界

- `init.ts`（DDL 幂等迁移）保持原生 SQL——建表脚本非运行时 ORM 职责；
- `wechatpay.ts`（外部 HTTP，无 DB）不动；
- 依赖：`sequelize` + 既有 `mysql2`。

## 执行门槛（验收标准）

1. `npx tsc --noEmit` **0 错误**；
2. `api-test.sh` **73/73** + `api-test-phase2.sh` **39/39** 全绿（在 TS + ORM 版服务端上跑）；
3. `grep` 确认 service 层除白名单兜底查询外无裸 SQL 字符串；
4. 三端零改动（契约回归由 112 项断言保证）。

## 执行顺序

前置 [005 三端分层](005-三端常量与工具分层规范.md) 已落地并复核 → 本迁移随即执行。

## 验证记录

执行时间：2026-10-13 · 执行环境：Node 20（nvm）+ MySQL 127.0.0.1/jiepai_platform · 服务端口 7010

### 1. 交付物

| 类别 | 内容 |
| --- | --- |
| 模型（8 个 + 桶，共 9 文件，`src/db/models/`） | `user.model.ts` / `worker.model.ts` / `service-category.model.ts` / `order.model.ts`（48 列，ENUM 含阶段二 `aborted`）/ `order-log.model.ts` / `wallet.model.ts`（无 created_at）/ `wallet-log.model.ts` / `notification.model.ts` + `index.ts`（sequelize 实例 + 关联，仅查询用不建约束） |
| 连接 parity 配置（`index.ts`） | `dateStrings:true` + `typeCast:true` → DATETIME 读回 `'YYYY-MM-DD HH:mm:ss'` 字符串；`flags:''` → 还原 mysql2 默认 FOUND_ROWS（`affectedRows`=匹配行数，CAS 判定依赖）；`timezone`=进程本地偏移 → Date 写入与 mysql2 `'local'` 一致；DECIMAL 保持字符串；`logging:false`；`pool.max` 取 `config.db.connectionLimit` |
| `db/pool.ts` | `query/one/transaction` 签名不变、内部改 sequelize；新增 `txQuery(t, sql, params)` 与 mysql2 `conn.query` 返回形状逐位对齐（SELECT→`[行数组]`，写→`[ResultSetHeader 形状]`）；`getPool()` 仅供 `seed.ts` 脚本 |
| 依赖 | 仅新增 `sequelize@6.37.8`；`init.ts` / `seed.ts` / `wechatpay.ts` / `scripts/run-sql.mjs` / controller / middleware / route 零改动 |

### 2. 各服务迁移方式

| 服务 | 方式 |
| --- | --- |
| worker / auth / user / wallet / notification / restrict | 全模型（findOne/findAll/findAndCountAll/create/update/increment/destroy/count） |
| admin | 概览看板/师傅列表/客户列表/师傅详情（多表 JOIN + COUNT/SUM/GROUP BY/FIELD 排序）走 `query()` 参数化兜底；师傅审核/启停、类目 CRUD 已改 Worker/ServiceCategory 模型 |
| order / pay | 状态机与退款决策表（`ORDER_SELECT` 四表 JOIN、CAS 更新、事务内钱包结算）保持原 SQL 文本，经 `query/one/txQuery`（sequelize 参数化）执行——SQL 语义零改动是契约不变的根基 |

### 3. 关键陷阱与修复

1. **`raw:true` + `include` 键名扁平化**（本次唯一真实回归，parity diff 抓出）：Sequelize 对 raw 行的 include 输出 `'w_user.name'` 扁平键而非嵌套对象，导致管理端钱包/流水/通知的 `name/phone/user_name/order_no` 全部丢失。修复：三处 include 查询加 `nest: true`（`wallet.service`×2、`notification.service`×1），修复后 parity 恢复一致。
2. **CAS `affectedRows` 语义**：Sequelize 默认连接位带 `-FOUND_ROWS`，`affectedRows` 会变成「实际变更行数」，no-op UPDATE 将得 0 而误判冲突——通过 `dialectOptions.flags:''` 还原，已用事务内烟测验证（no-op UPDATE `affectedRows=1`，CAS 未命中 `=0`，全程回滚）。
3. **时区**：Sequelize 默认 `+00:00` 会使写入时间整体提前 8 小时——`timezone` 设为进程本地偏移（东八区 `+08:00`）。
4. **`updated_at ON UPDATE CURRENT_TIMESTAMP`**：模型 `.update()` 显式携带 `updated_at`，与 MySQL 隐式更新等价（均为当前时刻）。
5. **`audited_at: NOW()`**（admin 师傅审核）：改模型后传本地时区时间串，与原 `NOW()` 写入一致。

### 4. 验收结果（全部达标）

1. `npx tsc --noEmit` → **0 错误**；
2. `bash scripts/api-test.sh` → **73/73**；`bash scripts/api-test-phase2.sh` → **39/39**（迁移前后均全绿）；
3. 残留裸 SQL 检查：service 层无字符串拼接注入面——所有动态 SQL 均为 `?` 占位参数化，模型调用覆盖 8 服务，`sequelize.query` 兜底 2 处（notification 守时扫描、worker 收入聚合）均带 `// [sequelize.query 兜底] 原因：…` 注释；
4. **接口 parity diff**：迁移前对 24 个接口采样基线（`/tmp/before_*.json`），迁移后同 token 重采对比——**键序、类型签名、DATETIME/DECIMAL 字符串格式 100% 一致**；表面差异全部为测试套件重置库导致的内容差异（行数/订单号/时间戳），逐一核实为数据非结构；
5. 三端零改动：controller / middleware / route / 前端 / 小程序未触碰（契约由 112 项断言回归保证）。


## 最终验收记录（二阶段深迁移收尾 · 2026-10-14 补录）

一阶段验收（上节）后继续执行二阶段深迁移，目标：**service 目录裸 SQL 彻底清零**（用户硬性要求：「不要直接写 sql 语句，后期维护很麻烦」，允许先改逻辑再改断言）。

### 改动方式

| 服务 | 二阶段方式 |
|---|---|
| `order.service` | hall/mine/adminList 改 `findAndCountAll + orderInclude()`（`db/order-join.ts` 共享助手）+ `raw/nest + flattenOrder`；dispatch 的 `one(SQL)` 改 `Worker.findOne + include user`；adminDetail 钱包流水 include（别名 `l_worker`）；adminCreate 模型化；`ORDER_SELECT` 常量删除 |
| `pay.service` | 全量重写：18 处 SQL → 模型 + 事务 + `findJoinedOrder`；Date 字段 3 处 `as Record<string, any>` 断言 |
| `admin.service` | 全量重写：看板 `Promise.all` 计数 + `fn/col` 聚合；trend/status_dist `cast`；workerList `FIELD()` 字面量排序；customerList 取当前页订单后 JS 归并（弃 CASE WHEN literal） |
| `notification.service` | `tick()` 守时扫描两处 `sequelize.query` → `Order.findAll + Op 时间窗 + include worker` |
| `worker.service` | `stats()` 收入聚合 → 模型取数 + 分单位 JS 归并 |
| `controller 收尾（008 顺带）` | `home.controller` 3 处裸 SQL（/home、/categories、/users/search）→ `ServiceCategory/Order/User` 模型 + `Promise.all` |
| `db/pool.ts` 瘦身 | `query/one/txQuery` 删除（service 清零 + home.controller 改造后无任何调用方）；仅留 `transaction`（业务事务入口）与 `getPool`（init/seed 脚本用） |

### 最终验收（全部达标，2026-10-14 复验）

1. **裸 SQL 清零**：`src/app/service/` 下 `sequelize.query / QueryTypes / query() / one() / txQuery()` **零调用**（仅剩 2 行注释描述迁移前老 SQL）；运行时代码（service + controller）不再执行任何手写 SQL 字符串；`init/seed` 脚本（DDL/种子灌数）保留 `getPool`，非运行时 ORM 职责；
2. `tsc -p server/tsconfig.json --noEmit` → **0 错误**；
3. 回归全绿（服务端重启后打运行中服务）：`api-test.sh` **73/73 FAIL=0**、`api-test-phase2.sh` **39/39 FAIL=0**；
4. **契约零变化**：`/home`（banners/categories 排序 min_price 数值化/notice/stats）、`/categories`、`/users/search`（存在/不存在/null）逐一 curl 对拍，键集与取值语义与迁移前一致；
5. 关键语义靠模型层还原：CAS `affectedRows`（`flags:''` 还原 FOUND_ROWS）、`raw+include` 键名扁平化（`nest:true + flattenOrder`）、FIELD 排序字面量须带主表别名（JOIN 后 = 模型名）——详见上节「关键陷阱」。
