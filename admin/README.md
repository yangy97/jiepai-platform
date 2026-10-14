# 接派 · 运营管理平台（admin）

「上门服务接单派单平台」的 Web 管理端，技术栈：**Vue 3 + TypeScript + Vite 5 + Element Plus + Pinia + Vue Router + ECharts**。

面向运营人员：登录后可查看运营概览、管理订单（代客下单 / 派单 / 改派 / 代操作状态流转）、审核与管理师傅、查看客户、维护服务类目、查看钱包与资金流水。

## 启动步骤

> 后端运行在 `http://127.0.0.1:7010`（需先启动 `server/`，并执行数据库初始化）。管理端 dev 通过 Vite 代理把 `/api` 转发到后端。

```bash
# 1. 安装依赖（建议 node 20+）
npm install

# 2. 启动开发服务器（端口 5178，已内置 /api 代理）
npm run dev
# 浏览器访问 http://localhost:5178

# 3. 生产构建（vue-tsc 类型检查 + vite build）
npm run build
npm run preview
```

## 演示账号

| 角色 | 手机号 | 密码 |
|---|---|---|
| 运营（管理端） | `13900000000` | `admin123` |

登录页提供「一键填充」按钮。非 `admin` 角色账号登录会被拒绝进入管理端。

## 目录说明

```
admin/
├── package.json / vite.config.ts / tsconfig*.json / index.html
└── src/
    ├── main.ts                 # 入口：Pinia / Router / Element Plus（中文语言包）
    ├── App.vue                 # 仅 <RouterView/>
    ├── style.css               # 全局样式（页面背景、卡片、滚动条等）
    ├── env.d.ts                # RouteMeta 类型扩展（isMenu/text/icon/public）
    ├── api/
    │   ├── http.ts             # axios 实例：token 注入、统一响应体处理、401 跳登录
    │   ├── types.ts            # 后端数据类型（对齐 docs/API.md 与 schema.sql）
    │   └── modules/            # auth/order/worker/customer/category/wallet/dashboard
    ├── stores/user.ts          # 登录态（token + user，持久化 localStorage）
    ├── router/index.ts         # 路由 + meta 驱动菜单 + 登录守卫
    ├── layouts/AdminLayout.vue # 深色侧边栏布局（面包屑 / 折叠 / 用户下拉）
    ├── components/SubMenu.vue  # 依据 meta.isMenu 递归渲染的菜单组件
    ├── utils/format.ts         # 状态标签、金额、时间等格式化工具
    └── views/                  # Login / Dashboard / order / worker / customer / category / wallet
```

## 接口约定

所有接口与响应体格式以项目根目录 `docs/API.md` 为准；管理端接口前缀 `/api/admin/*`，鉴权方式 `Authorization: Bearer <token>`。
