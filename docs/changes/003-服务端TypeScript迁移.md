# [003] 服务端全量迁移 TypeScript（strict + tsx 直跑）

- 日期：2026-10-13
- 状态：已完成
- 涉及端：server

## 需求点

- 服务端从 JavaScript 全量迁移 TypeScript，且要 **strict 严格模式**，提升维护性与重构安全性。
- 不引入编译构建步骤（保持 Demo 简单）：**tsx 直跑**。

## 改动明细

| 文件/目录 | 改动内容 |
|---|---|
| `src/**/*.js` → `*.ts` | 31 个文件全量迁移，原 .js 删除；CommonJS `require` → ESM `import` |
| `tsconfig.json` | `strict: true`（含 noImplicitAny / strictNullChecks）全开 |
| `src/types/index.ts` | 11 个 DB 行类型（UserRow/OrderRow/…）+ 泛型 `query<T>/one<T>` 签名 + `AuthedRequest` |
| `src/types/express.d.ts` | 声明合并：`rawBody` 等扩展属性 |
| `src/app/service/order.constant.ts` | `formatOrder` 泛型重载签名 |
| `package.json` | `dev/start` 走 `tsx src/server.ts`；新增 `npm run typecheck`（`tsc --noEmit`） |
| `scripts/*.ts` | 初始化/种子脚本全部 tsx 执行 |
| `../scripts/api-test.sh` | 双路径检测：存在 `src/db/init.ts` 时用 `tsx` 初始化，解除了对 .js 路径的硬耦合 |

## 关键决策

- **tsx 直跑免编译**：不需要 build 步骤，改完即生效；`tsc --noEmit` 单独做类型把关（进 `npm run typecheck`）。
- DB 行类型手写而非代码生成：11 个类型集中在 `types/index.ts`，与 schema 一一对应，加字段时改两处（init.ts + 类型）。
- 测试脚本通过 `server/scripts/run-sql.mjs`（mysql2 直连）+ api-test.sh 双路径，兼容 tsx 迁移期的脚本调用（**此文件勿删**，测试脚本依赖）。

## 验证记录

- `npx tsc --noEmit` **0 错误**；
- `find src -name "*.js"` 为空、CommonJS `require` 0 处；
- 迁移后在 TS 版服务端上复跑两套测试：`api-test.sh` 73/73 + `api-test-phase2.sh` 39/39（合计 112 项全绿）。
