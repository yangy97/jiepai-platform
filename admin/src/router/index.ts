import {
  Grid,
  List,
  Odometer,
  User,
  UserFilled,
  Wallet,
} from '@element-plus/icons-vue'
import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { hidden: true, public: true },
    },
    {
      path: '/',
      name: 'root',
      component: () => import('@/layouts/AdminLayout.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
          meta: { isMenu: true, text: '概览', icon: Odometer },
        },
        {
          path: 'orders',
          name: 'orders',
          component: () => import('@/views/order/OrderListView.vue'),
          meta: { isMenu: true, text: '订单管理', icon: List },
        },
        {
          path: 'workers',
          name: 'workers',
          component: () => import('@/views/worker/WorkerListView.vue'),
          meta: { isMenu: true, text: '师傅管理', icon: User },
        },
        {
          path: 'customers',
          name: 'customers',
          component: () => import('@/views/customer/CustomerListView.vue'),
          meta: { isMenu: true, text: '客户管理', icon: UserFilled },
        },
        {
          path: 'categories',
          name: 'categories',
          component: () => import('@/views/category/CategoryListView.vue'),
          meta: { isMenu: true, text: '服务类目', icon: Grid },
        },
        {
          path: 'wallets',
          name: 'wallets',
          component: () => import('@/views/wallet/WalletListView.vue'),
          meta: { isMenu: true, text: '结算中心', icon: Wallet },
        },
      ],
    },
  ],
})

// 全局前置守卫：未登录（无 token）一律跳登录页，白名单仅 /login
router.beforeEach((to) => {
  const userStore = useUserStore()
  if (to.meta.public) {
    // 已登录访问登录页 → 直接进概览
    if (to.path === '/login' && userStore.token) {
      return '/dashboard'
    }
    return true
  }
  if (!userStore.token) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
