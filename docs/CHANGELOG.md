# 变更总账（需求点索引）

每次功能/架构改动在 `docs/changes/` 新增一条需求点记录（模板见 `_TEMPLATE.md`），本文件维护索引。**新改动先建记录再动手，完成后补验证记录。**

| 编号 | 日期 | 需求点 | 涉及端 | 状态 |
|---|---|---|---|---|
| [001](changes/001-微信支付真实接入.md) | 2026-10-13 | 微信支付真实流程接入（mock 开关 + APIv3 占位） | server / admin / miniapp | ✅ 已完成 |
| [002](changes/002-中途退出-退款锁定-多维评价-消息通知.md) | 2026-10-13 | 阶段二：中途退出 / 退款政策下单锁定 / 多维双向评价 / 消息通知 / 低分限制 | server / admin / miniapp | ✅ 已完成 |
| [003](changes/003-服务端TypeScript迁移.md) | 2026-10-13 | 服务端全量迁移 TypeScript（strict + tsx 直跑） | server | ✅ 已完成 |
| [004](changes/004-SQL注入安全审计.md) | 2026-10-13 | SQL 注入面审计与攻击实测 | server | ✅ 已完成 |
| [005](changes/005-三端常量与工具分层规范.md) | 2026-10-13 | 三端常量归 constants/、工具归 util/ 规范分层 | server / admin / miniapp | 🚧 进行中（服务端部分） |
| [006](changes/006-Sequelize-ORM迁移.md) | 2026-10-13 | 引入 Sequelize ORM（模型层 + 混合查询策略，二阶段收尾裸 SQL 清零） | server | ✅ 已完成 |
| [007](changes/007-微信订阅消息推送.md) | 2026-10-14 | 微信订阅消息推送（小程序授权 + wxPush 真实代码 + 占位配置） | server / miniapp | ✅ 已完成 |
| [008](changes/008-订阅消息授权引导.md) | 2026-10-14 | 订阅消息授权引导（状态感知横幅 + 关键节点说明弹窗，移除无提示弹窗） | miniapp / server | ✅ 已完成 |

## 文档体系

| 文档 | 职责 |
|---|---|
| `docs/API.md` | 三端共享接口契约（**唯一事实来源**，接口改动必须同步此文件） |
| `docs/DESIGN-phase2.md` | 阶段二设计蓝本（退款决策表 / 通知事件 / 惩罚规则） |
| `docs/CHANGELOG.md` | 本文件：变更总账索引 |
| `docs/changes/*.md` | 单条需求点完整记录（背景 / 明细 / 决策 / 验证 / 使用） |
