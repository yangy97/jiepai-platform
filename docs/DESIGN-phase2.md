# 接派平台 · 阶段二需求设计（中途退出 / 退款政策 / 通知 / 评价与惩罚）

> 状态：设计定稿，待实施。实施顺序：服务端 → 小程序 / 管理端 → 测试。
> 与 `API.md` 的支付章节（阶段一）合并构成完整契约；本文档为增量。

## 0. 需求来源（用户决策记录）

1. 接单/中途取消/取消后的**退款要有中间态与明细**：退款金额、原因、按进度计费。
2. **退款政策下单时锁定**：下单约定支持与否，开工后按约定强制执行。
3. 「中途」从**开工（working）起算**；预约时间（`expect_at`）之前未开工 → 一律可全额退款。
4. 接单人须**按时上门**，需要**消息通知**（派单/接单/超时提醒/退款/评价/处罚）。
5. hourly 单中途退出按**半小时向上取整**（40 分钟 = 1 小时 × 时薪）。
6. 评价：**多维度 + 双向互评**；评分低于阈值**限制接单/发单一段时间**。

## 1. 订单字段增量（schema 迁移，幂等）

```sql
ALTER TABLE orders
  -- 下单锁定（不可变）
  ADD COLUMN refund_policy  VARCHAR(16) NOT NULL DEFAULT 'flexible' COMMENT 'flexible支持中途退款/strict不可中途退款',
  ADD COLUMN billing_type   VARCHAR(16) NOT NULL DEFAULT 'fixed'    COMMENT 'fixed一口价/hourly时薪',
  ADD COLUMN hourly_price   DECIMAL(10,2) NOT NULL DEFAULT 0        COMMENT '时薪(billing_type=hourly)',
  -- 中途结束
  ADD COLUMN abort_reason   VARCHAR(255) NOT NULL DEFAULT ''        COMMENT '中途结束原因',
  ADD COLUMN aborted_at     DATETIME NULL,
  ADD COLUMN actual_fee     DECIMAL(10,2) NOT NULL DEFAULT 0        COMMENT '中途结算实收金额',
  -- 退款明细（refund_id/refunded_at 由支付模块阶段一提供）
  ADD COLUMN refund_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN refund_reason  VARCHAR(255) NOT NULL DEFAULT '',
  -- 多维评价（客户→师傅）
  ADD COLUMN rate_skill     TINYINT NULL COMMENT '技术1-5',
  ADD COLUMN rate_attitude  TINYINT NULL COMMENT '态度1-5',
  ADD COLUMN rate_punctual  TINYINT NULL COMMENT '准时1-5',
  ADD COLUMN rate_tags      VARCHAR(200) NOT NULL DEFAULT '' COMMENT '快捷标签,逗号分隔',
  -- 双向评价（师傅→客户）
  ADD COLUMN worker_rating      TINYINT NULL COMMENT '客户配合度1-5',
  ADD COLUMN worker_rate_comment VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN worker_rate_tags   VARCHAR(200) NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN rating DECIMAL(2,1) NOT NULL DEFAULT 5.0,
  ADD COLUMN restricted TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN restricted_reason VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN restricted_until DATETIME NULL;

ALTER TABLE workers ADD COLUMN restricted TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN restricted_reason VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN restricted_until DATETIME NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NULL,
  type VARCHAR(32) NOT NULL COMMENT 'dispatch/accept/start_remind/start_timeout/finish/confirm/refund/rate/restrict/...',
  title VARCHAR(100) NOT NULL,
  content VARCHAR(255) NOT NULL,
  is_read TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 2. 状态机增量

```
pending → dispatched → accepted → working → finished → completed
   ↓          ↓           ↓          │           ↑
 cancelled  cancelled   cancelled    │  (师傅中途退出/运营中途结束)
                          ▲          ▼
                          └──── aborted（中途结束·待客户确认实收）──→ completed
```

- **新增状态 `aborted`（中途结束）**：仅 `working → aborted`。语义：服务已开始但提前终止，**待确认实收的中间态**。
- `aborted → completed`：客户 `POST /orders/:id/confirm`（复用现有确认结算，用 `actual_fee` 入账）；运营可代确认。
- `aborted` 不可 → `cancelled`（服务已发生，必须结算；争议走运营手动退款）。
- 状态文本：`aborted = 中途结束`。

### 2.1 取消与退款决策表（服务端强制）

| 时刻 | 政策 | 客户取消行为 |
|---|---|---|
| 开工前（pending/dispatched/accepted，**含未到预约时间**） | 任意 | `cancelled` + **已支付自动全额退款**（`refund_amount = 全额`，`refund_reason='开工前取消，全额退款'`） |
| 开工后（working） | `flexible` | `cancelled` + **按进度退款**：`实收 = 已服务时长计费`，`refund = 已付 − 实收`，`actual_fee` 记实收 |
| 开工后（working） | `strict` | **拒绝**：`409 按下单约定不支持中途退款`（只能由运营手动处理） |
| 开工后（working） | 运营强制 | 允许取消 + 走手动退款接口（带金额输入，留审计日志） |

- **hourly 实收公式**：`hours = ceil(已服务分钟 / 30) × 0.5`；`实收 = hourly_price × hours`，上限为已付金额。
- **fixed 实收**：由操作发起方填写（默认 budget），客户在 aborted 确认时可看到金额。
- 已支付判定：`pay_status = 'paid'`；退款幂等：仅 `paid` 可退，退过变 `refunded` 不可再退（除非运营手动补退走独立入口，Demo 不做）。

### 2.2 中途结束操作

| 操作 | 鉴权 | 入参 |
|---|---|---|
| `POST /api/orders/:id/abort` | 接单师傅 / 运营 | `{ reason(必填), price?(fixed单必填实收) }` |

- hourly 单服务端按公式自动算 `actual_fee`，忽略 price。
- 触发通知：给客户发「订单中途结束待确认」，给师傅发「中途结束已提交」。
- `strict` 单也可由师傅发起 aborted（师傅责任退出），但**不自动退款**，实收照常结算；差额争议由运营手动退。

## 3. 守时与通知

### 3.1 守时约束

- `expect_at`（期望上门时间）为锚点：
  - 师傅端接单后展示「距预约上门还有 X」倒计时。
  - **超时检测**（服务端 `setInterval` 5 分钟扫一次，进程内定时器，Demo 够用）：
    - `accepted` 且 `expect_at < now - 30min` 未开工 → 给师傅发 `start_timeout` 通知（「已超预约时间，请尽快上门或联系客户」）+ 给客户发同步通知 + 写 `order_logs`。
    - `accepted` 且 `expect_at` 前 30 分钟 → 给师傅发 `start_remind` 提醒（每单每种只发一次，靠 type+order_id 去重）。
  - 准时情况反映在评价维度 `rate_punctual`。

### 3.2 站内通知（三端）

- 事件落库 `notifications`（发送失败不影响主流程，try/catch）：
  | 事件 | 接收人 | type |
  |---|---|---|
  | 运营派单 | 师傅 | `dispatch` |
  | 师傅接单 | 客户 | `accept` |
  | 预约前 30min 提醒 | 师傅 | `start_remind` |
  | 超预约 30min 未开工 | 师傅+客户 | `start_timeout` |
  | 师傅完工 | 客户 | `finish` |
  | 客户确认结算 | 师傅 | `confirm` |
  | 退款完成 | 客户 | `refund` |
  | 中途结束待确认 | 客户 | `abort` |
  | 收到评价 | 师傅 / 客户 | `rate` |
  | 被限制接单/发单 | 师傅 / 客户 | `restrict` |

- **接口**：
  - `GET /api/notifications?unread=1&page=` → 分页 + 未读数
  - `POST /api/notifications/read-all`（或 `{ ids: [] }`）
- **小程序**：「我的」页顶部消息条（未读红点数字）→ 新页 `pages/message/message` 列表，点条目跳对应订单详情。tabBar 不增加项（控制范围）。
- **管理端**：顶栏铃铛 + 未读角标 + 下拉最近 10 条，点击已读/全部已读。
- **微信订阅消息**：本期**不接**（需模板审核），通知中心已覆盖；接口层留 `notify.wxPush()` 空实现 + 注释 TODO，未来接。

## 4. 多维 + 双向评价

### 4.1 客户 → 师傅（completed 后，已有 `rate` 接口扩展）

- 入参：`{ rating(总分必填), skill, attitude, punctual(各1-5), tags: string[], comment }`
- `tags` 候选（小程序快捷点选）：`准时到达, 技术专业, 服务态度好, 收费合理, 二次上门`（≤3 个）。
- 师傅 `rating` 聚合：保持现有增量算法，改用**总分**（不动语义）。

### 4.2 师傅 → 客户（completed 后新增）

- `POST /api/orders/:id/rate-worker`：`{ rating, tags?, comment? }`（师傅评客户，仅接单人，仅一次）
- tags 候选：`沟通顺畅, 地址清晰, 守约配合, 需求明确`。

### 4.3 低分惩罚（阈值限制）

- 配置：`RESTRICT_MIN_RATING = 3.0`、`RESTRICT_WINDOW = 5`（近 5 次被评）、`RESTRICT_DAYS = 7`（均可 env 覆盖）。
- 触发：每次评价提交后，事务内取被评人**最近 N 次有效被评均分**，低于阈值 → 置 `restricted=1` + `restricted_reason='近5单平均评分3.0以下'` + `restricted_until=now+7天`，发 `restrict` 通知。
- 拦截：
  - 师傅：抢单 `accept`、被派单 `dispatch` 校验 → `403 账号受限中（原因），解除时间 xx`。
  - 客户：下单 `POST /orders` 校验 → 同上。
- 解除：到期自动（校验时发现 `restricted_until < now` 即清零并放行）；运营也可手动解除。
- 管理端：师傅/客户列表加「受限」标签 + 操作「解除限制」。

## 5. 退款明细展示（三端）

订单详情（小程序/管理端）资金区：

```
支付金额   ¥150.00   （paid_at / 交易单号）
实收金额   ¥60.00    （hourly: 1.0h × ¥60 或 fixed 手填）
退款金额   ¥90.00    （refund_reason / refunded_at / 微信退款单号）
退款政策   支持中途退款 / 不支持中途退款（下单锁定，只读）
计费方式   一口价 / 时薪 ¥60/h
```

`aborted` 中间态额外显示：`开工时间 started_at → 中止时间 aborted_at`、时长、`abort_reason`。

## 6. 实施批次

| 批 | 内容 | 目录 |
|---|---|---|
| 批0 | 阶段一支付模块交付后回归（api-test 56 项 + 支付新增项） | server/scripts |
| 批1 | schema 迁移 + 状态机 aborted + 取消/退款决策表 + abort 接口 + 退款明细 | server |
| 批2 | 通知表/接口/事件 + 超时定时器 + 守时倒计时 | server → miniapp → admin |
| 批3 | 多维评价扩展 + 双向评价 + 惩罚限制 + 解除接口 | server → miniapp → admin |
| 批4 | 三端 UI：下单退款政策/计费方式选择、中途退出、资金明细、消息中心、评分 UI、受限标签 | miniapp/admin |
| 批5 | api-test.sh 扩容（政策矩阵/取整/通知/惩罚用例）+ README 更新 | scripts |

## 7. 兼容性约定

- 老订单（迁移前）：`refund_policy='flexible'`、`billing_type='fixed'`、评价字段 NULL → 三端 UI 全部 `v-if` 兜底。
- 现有 56 项测试不断：默认 flexible + fixed；开工前取消即退款是新增行为，测试中无「已支付后开工前取消」用例则不受影响（批5 会显式覆盖）。
- 状态枚举新增 `aborted` 后，`ORDER_STATUS_META`、状态筛选下拉、状态分布看板同步补齐。
