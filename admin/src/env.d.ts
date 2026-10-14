/// <reference types="vite/client" />

import type { Component } from 'vue'

// 扩展 vue-router 的 RouteMeta，支持菜单驱动的 meta 字段
declare module 'vue-router' {
  interface RouteMeta {
    /** 是否在侧边栏菜单中展示 */
    isMenu?: boolean
    /** 菜单/面包屑文案 */
    text?: string
    /** 菜单图标（element-plus icon 组件） */
    icon?: Component
    /** 不渲染菜单 */
    hidden?: boolean
    /** 无需登录即可访问 */
    public?: boolean
  }
}

export {}
