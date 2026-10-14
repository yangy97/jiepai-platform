<template>
  <!-- 依据 route.meta.isMenu 递归渲染菜单项（照 oa_template 约定） -->
  <template v-if="route.meta?.isMenu">
    <ElMenuItem v-if="!route.children || route.children.length === 0" :index="String(route.name)">
      <ElIcon>
        <component :is="route.meta?.icon" />
      </ElIcon>
      <template #title>
        <RouterLink :to="{ name: route.name }" :style="{ color: 'inherit', textDecoration: 'none' }">
          {{ route.meta?.text }}
        </RouterLink>
      </template>
    </ElMenuItem>
    <template v-else>
      <ElSubMenu :index="String(route.name)">
        <template #title>
          <ElIcon>
            <component :is="route.meta?.icon" />
          </ElIcon>
          <span>{{ route.meta?.text }}</span>
        </template>
        <template v-for="child in route.children" :key="child.path">
          <SubMenu :route="child" />
        </template>
      </ElSubMenu>
    </template>
  </template>
</template>

<script setup lang="ts">
import type { RouteRecordRaw } from 'vue-router'
import { ElIcon, ElMenuItem, ElSubMenu } from 'element-plus'

defineOptions({
  name: 'SubMenu',
})
const { route } = defineProps<{ route: RouteRecordRaw }>()
</script>
