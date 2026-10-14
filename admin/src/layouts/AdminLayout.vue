<template>
  <ElContainer class="admin-layout">
    <!-- 深色侧边栏 -->
    <ElAside style="background-color: #001529; width: auto">
      <ElMenu
        mode="vertical"
        background-color="#001529"
        text-color="#fff"
        active-text-color="#1890ff"
        :default-active="activeKey"
        :collapse="collapsed"
        class="menu"
      >
        <div class="logo">
          <span class="logo-badge">接</span>
          <h5 v-if="!collapsed" class="logo-text">接派 · 运营平台</h5>
        </div>
        <SubMenu v-for="route in menuRoutes" :key="String(route.name)" :route="route" />
      </ElMenu>
    </ElAside>

    <ElContainer>
      <!-- 顶栏：折叠按钮 + 面包屑 + 用户下拉 -->
      <ElHeader class="header">
        <div style="display: flex; align-items: center">
          <ElIcon class="trigger" size="18" @click="() => (collapsed = !collapsed)">
            <Expand v-if="collapsed" />
            <Fold v-else />
          </ElIcon>
          <ElBreadcrumb style="margin-left: 8px">
            <ElBreadcrumbItem v-for="item in breadcrumbs" :key="item.path">
              {{ item.meta.text }}
            </ElBreadcrumbItem>
          </ElBreadcrumb>
        </div>
        <div style="display: flex; align-items: center; gap: 12px">
          <ElTag type="primary">运营后台</ElTag>
          <!-- 阶段二：站内消息铃铛（未读角标 + 最近 10 条 + 全部已读） -->
          <!-- after-enter：弹层展开时刷新，保证「操作后」再打开铃铛能看到最新消息 -->
          <ElPopover placement="bottom-end" :width="340" trigger="click" @after-enter="loadNotifications">
            <template #reference>
              <ElBadge
                :value="unreadCount"
                :hidden="unreadCount <= 0"
                :max="99"
                class="bell-badge"
                aria-label="消息通知"
              >
                <ElIcon class="bell-icon" :size="18"><Bell /></ElIcon>
              </ElBadge>
            </template>
            <div class="notice-panel">
              <div class="notice-head">
                <span class="notice-head-title">消息通知</span>
                <ElButton
                  link
                  type="primary"
                  size="small"
                  :disabled="!notices.length || unreadCount <= 0"
                  @click="markAllRead"
                >
                  全部已读
                </ElButton>
              </div>
              <div v-if="notices.length" class="notice-list">
                <div
                  v-for="n in notices"
                  :key="n.id"
                  class="notice-item"
                  :class="{ unread: !n.is_read }"
                >
                  <div class="notice-title">
                    <span v-if="!n.is_read" class="notice-dot" />
                    {{ n.title }}
                  </div>
                  <div class="notice-content">{{ n.content }}</div>
                  <div class="notice-time">{{ formatTime(n.created_at) }}</div>
                </div>
              </div>
              <ElEmpty v-else description="暂无消息" :image-size="60" />
            </div>
          </ElPopover>
          <ElDropdown @command="handleCommand">
            <span class="user-trigger">
              <ElAvatar :size="28" class="user-avatar">{{ userInitial }}</ElAvatar>
              <span class="user-name">{{ userStore.user?.name || '运营' }}</span>
              <ElIcon><ArrowDown /></ElIcon>
            </span>
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="logout">退出登录</ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </div>
      </ElHeader>

      <!-- 内容区 -->
      <ElMain class="content">
        <RouterView />
      </ElMain>

      <ElFooter class="footer">
        <div>接派 · 上门服务接单派单平台</div>
        <div>JiePai Operations © 2026</div>
      </ElFooter>
    </ElContainer>
  </ElContainer>
</template>

<script setup lang="ts">
import { ArrowDown, Bell, Expand, Fold } from '@element-plus/icons-vue'
import {
  ElAside,
  ElAvatar,
  ElBadge,
  ElBreadcrumb,
  ElBreadcrumbItem,
  ElButton,
  ElContainer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElFooter,
  ElHeader,
  ElIcon,
  ElMain,
  ElMenu,
  ElPopover,
  ElTag,
} from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter, type RouteLocationNormalized, type RouteRecordRaw } from 'vue-router'
import { fetchNotifications, readNotifications } from '@/api/modules/notification'
import type { Notification } from '@/api/types'
import SubMenu from '@/components/SubMenu.vue'
import { useUserStore } from '@/stores/user'
import { formatTime } from '@/utils/format'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const collapsed = ref(false)

// ---------- 阶段二：站内消息（简单方案：登录进布局拉一次 + 每次展开铃铛再刷一次，操作后动线由展开触发） ----------
const notices = ref<Notification[]>([])
const unreadCount = ref(0)

/** 拉取最近 10 条通知 + 未读数 */
async function loadNotifications() {
  try {
    const res = await fetchNotifications({ page: 1, page_size: 10 })
    notices.value = res.list ?? []
    unreadCount.value = res.unread_count ?? 0
  } catch {
    // 错误已由 http 拦截器提示，消息角标失败不影响主流程
  }
}

/** 全部标记已读（ids 缺省 = 全部） */
async function markAllRead() {
  try {
    const res = await readNotifications()
    unreadCount.value = res.unread_count ?? 0
    notices.value = notices.value.map((n) => ({ ...n, is_read: 1 }))
  } catch {
    // 错误已由 http 拦截器提示
  }
}

onMounted(loadNotifications)

// 菜单只渲染 meta.isMenu 的路由（取根布局路由的 children）
const menuRoutes = computed<RouteRecordRaw[]>(() => {
  const root = router.options.routes.find((r) => r.path === '/')
  return (root?.children ?? []).filter((r) => r.meta?.isMenu)
})

// 当前高亮菜单项
const activeKey = ref<string>('')
function syncActive(to: RouteLocationNormalized) {
  activeKey.value = String(to.name ?? '')
}
syncActive(route)
router.afterEach((to) => syncActive(to))

// 面包屑取 route.matched 的 meta.text
const breadcrumbs = computed(() =>
  route.matched.filter((item) => item.meta?.text).map((item) => ({ path: item.path, meta: item.meta })),
)

// 头像首字
const userInitial = computed(() => (userStore.user?.name || '运').slice(0, 1))

// 退出登录
function handleCommand(command: string | number | object) {
  if (command === 'logout') {
    userStore.logout()
    router.replace('/login')
  }
}
</script>

<style scoped>
/* 撑满整个视口：侧边栏与内容区不留白边 */
.admin-layout {
  height: 100vh;
  height: 100%;
  overflow: hidden;
}

/* 右侧为列布局（显式声明，不依赖 :has() 兼容性） */
.admin-layout > .el-container {
  flex-direction: column;
  min-width: 0;
}

.header {
  background: #fff;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
  position: relative;
  z-index: 5;
  flex-shrink: 0;
}

.content {
  margin: 8px;
  padding: 16px;
  overflow: hidden;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0 8px 8px 8px;
  padding: 8px 16px;
  background: #fff;
  color: #909399;
  font-size: 12px;
  border-radius: 6px;
  flex-shrink: 0;
}

/* 侧边栏整列高度，菜单超高时内部滚动 */
.admin-layout .el-aside {
  height: 100%;
  overflow: hidden;
}

.admin-layout .menu {
  height: 100%;
  overflow-y: auto;
  border-right: none;
}

.trigger {
  cursor: pointer;
  color: rgba(0, 0, 0, 0.65);
}

.trigger:hover {
  color: #1890ff;
}

.logo {
  padding: 14px 0;
  margin: 0 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-badge {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(135deg, #1890ff, #003a8c);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  line-height: 26px;
  text-align: center;
  flex-shrink: 0;
}

.logo-text {
  font-size: 15px;
  line-height: 15px;
  margin: 0;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.85);
}

.menu:not(.el-menu--collapse) {
  width: 210px;
  border-right: none;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: rgba(0, 0, 0, 0.75);
  outline: none;
}

.user-avatar {
  background: #1890ff;
  color: #fff;
  font-size: 13px;
}

.user-name {
  font-size: 13px;
}

/* 消息铃铛 */
.bell-badge {
  cursor: pointer;
  outline: none;
}

.bell-icon {
  color: rgba(0, 0, 0, 0.65);
}

.bell-badge:hover .bell-icon {
  color: #1890ff;
}

/* 消息面板 */
.notice-panel {
  max-height: 380px;
  display: flex;
  flex-direction: column;
}

.notice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.notice-head-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}

.notice-list {
  overflow-y: auto;
  max-height: 320px;
}

.notice-item {
  padding: 8px 6px;
  border-bottom: 1px solid #f2f3f5;
  border-radius: 4px;
}

.notice-item:last-child {
  border-bottom: none;
}

/* 未读：浅蓝底 + 加粗标题 */
.notice-item.unread {
  background: #f0f7ff;
}

.notice-title {
  font-size: 13px;
  color: #303133;
  display: flex;
  align-items: center;
  gap: 6px;
}

.notice-item.unread .notice-title {
  font-weight: 600;
  color: #1668dc;
}

.notice-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5222d;
  flex-shrink: 0;
}

.notice-content {
  margin-top: 2px;
  font-size: 12px;
  color: #606266;
  line-height: 1.5;
  word-break: break-all;
}

.notice-time {
  margin-top: 2px;
  font-size: 12px;
  color: #909399;
}
</style>
