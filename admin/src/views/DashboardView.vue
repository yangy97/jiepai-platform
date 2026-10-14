<template>
  <div v-loading="loading">
    <!-- 顶部统计卡片 -->
    <ElRow :gutter="12" class="stat-row">
      <ElCol v-for="card in statCards" :key="card.label" :xs="12" :sm="8" :md="4">
        <ElCard shadow="never" class="stat-card">
          <div class="stat-head">
            <span>{{ card.label }}</span>
            <ElIcon :size="18" :style="{ color: card.color }">
              <component :is="card.icon" />
            </ElIcon>
          </div>
          <div class="stat-num" :style="{ color: card.color }">{{ card.value }}</div>
          <div class="stat-sub">{{ card.sub }}</div>
        </ElCard>
      </ElCol>
    </ElRow>

    <!-- 图表区：左趋势 右状态分布 -->
    <ElRow :gutter="12" style="margin-top: 12px">
      <ElCol :xs="24" :md="14">
        <ElCard shadow="never">
          <template #header>近 7 日订单趋势</template>
          <div v-if="data?.trend?.length" ref="trendRef" class="chart-box" />
          <ElEmpty v-else description="暂无趋势数据" :image-size="80" />
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :md="10">
        <ElCard shadow="never">
          <template #header>订单状态分布</template>
          <div v-if="statusDist.length" ref="distRef" class="chart-box" />
          <ElEmpty v-else description="暂无订单数据" :image-size="80" />
        </ElCard>
      </ElCol>
    </ElRow>

    <!-- 最新订单 -->
    <ElCard shadow="never" style="margin-top: 12px">
      <template #header>
        <div class="table-title">
          <span>最新订单</span>
          <ElButton link type="primary" @click="router.push('/orders')">查看全部</ElButton>
        </div>
      </template>
      <ElTable
        :data="data?.recent ?? []"
        v-loading="loading"
        empty-text="暂无订单"
        @row-click="(row: Order) => goOrder(row)"
      >
        <ElTableColumn prop="order_no" label="订单号" width="170" />
        <ElTableColumn prop="title" label="标题" min-width="140" show-overflow-tooltip />
        <ElTableColumn label="类目" width="130">
          <template #default="{ row }">
            <div class="cat-cell">
              <span>{{ row.category_icon || '🔧' }} {{ categoryLabel(row).text }}</span>
              <ElTag v-if="categoryLabel(row).custom" type="warning" size="small" effect="plain">自定义</ElTag>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="100">
          <template #default="{ row }">
            <ElTag :type="orderStatusTag(row.status)" size="small" effect="light">
              {{ orderStatusLabel(row.status) }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="客户" width="120">
          <template #default="{ row }">{{ row.customer_name || `客户#${row.customer_id}` }}</template>
        </ElTableColumn>
        <ElTableColumn label="下单时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </ElTableColumn>
      </ElTable>
    </ElCard>
  </div>
</template>

<script setup lang="ts">
import { Calendar, Coin, Odometer, Star, UserFilled, User } from '@element-plus/icons-vue'
import { ElCard, ElCol, ElEmpty, ElIcon, ElRow, ElTable, ElTableColumn, ElTag, ElButton } from 'element-plus'
import * as echarts from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchDashboard } from '@/api/modules/dashboard'
import type { DashboardData, Order } from '@/api/types'
import { formatMoney, formatTime, orderStatusLabel, orderStatusTag, categoryLabel } from '@/utils/format'

const router = useRouter()
const loading = ref(false)
const data = ref<DashboardData>()

/** 统计卡片配置 */
const statCards = computed(() => {
  const stat = data.value?.stat
  return [
    { label: '今日订单', value: stat?.today_count ?? 0, icon: Calendar, color: '#1890ff', sub: `累计 ${stat?.order_count ?? 0} 单` },
    { label: '待派单', value: stat?.pending_dispatch ?? 0, icon: Odometer, color: '#fa8c16', sub: `进行中 ${stat?.doing ?? 0} 单` },
    { label: '师傅数', value: stat?.worker_count ?? 0, icon: User, color: '#52c41a', sub: '已入驻师傅' },
    { label: '客户数', value: stat?.customer_count ?? 0, icon: UserFilled, color: '#722ed1', sub: '注册客户' },
    { label: '累计成交额', value: `¥${formatMoney(stat?.done_amount)}`, icon: Coin, color: '#13c2c2', sub: '已完成订单总额' },
    { label: '平均评分', value: stat?.avg_rating ?? '—', icon: Star, color: '#f5222d', sub: '客户评价均分' },
  ]
})

/** 状态分布（图表数据） */
const statusDist = computed(() => data.value?.status_dist ?? [])

// ---- ECharts ----
const trendRef = ref<HTMLElement>()
const distRef = ref<HTMLElement>()
let trendChart: echarts.ECharts | null = null
let distChart: echarts.ECharts | null = null

function renderTrendChart() {
  if (!trendRef.value) return
  trendChart = echarts.init(trendRef.value)
  const trend = data.value?.trend ?? []
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    xAxis: { type: 'category', data: trend.map((t) => t.date), axisLine: { lineStyle: { color: '#d9d9d9' } } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    series: [
      {
        name: '订单数',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        data: trend.map((t) => t.count),
        itemStyle: { color: '#1890ff' },
        areaStyle: { color: 'rgba(24,144,255,0.12)' },
      },
    ],
  })
}

function renderDistChart() {
  if (!distRef.value) return
  distChart = echarts.init(distRef.value)
  const dist = statusDist.value
  distChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
    series: [
      {
        name: '订单状态',
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        label: { formatter: '{b}: {c}' },
        data: dist.map((d) => ({ name: d.text || d.status, value: d.count })),
      },
    ],
  })
}

function handleResize() {
  trendChart?.resize()
  distChart?.resize()
}

/** 加载概览数据 */
async function load() {
  loading.value = true
  try {
    data.value = await fetchDashboard()
    await nextTick()
    renderTrendChart()
    renderDistChart()
  } finally {
    loading.value = false
  }
}

/** 点击行 → 跳订单列表并带关键字 */
function goOrder(row: Order) {
  router.push({ path: '/orders', query: { keyword: row.order_no } })
}

onMounted(() => {
  load()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  distChart?.dispose()
  trendChart = null
  distChart = null
})
</script>

<style scoped>
.stat-card {
  margin-bottom: 12px;
}

.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #909399;
}

.chart-box {
  height: 280px;
  width: 100%;
}

.table-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 类目列：文案 + 自定义标签 */
.cat-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
