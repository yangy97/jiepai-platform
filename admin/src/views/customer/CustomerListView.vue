<template>
  <div class="page">
    <!-- 搜索区 -->
    <div class="filter-bar">
      <ElInput
        v-model="query.keyword"
        placeholder="姓名/手机号，回车查询"
        clearable
        style="width: 220px"
        :prefix-icon="Search"
        @keyup.enter="search"
        @clear="search"
      />
      <ElButton type="primary" :icon="Search" @click="search">查询</ElButton>
    </div>

    <!-- 客户表格：撑满剩余高度，表体在可视区内滚动 -->
    <div class="table-wrap">
      <ElTable v-loading="loading" :data="list" empty-text="暂无客户" style="width: 100%">
        <ElTableColumn label="姓名" width="120">
          <template #default="{ row }">{{ row.name || '未填写' }}</template>
        </ElTableColumn>
        <ElTableColumn prop="phone" label="手机号" width="140" />
        <ElTableColumn label="注册时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </ElTableColumn>
        <ElTableColumn label="订单数" width="100" align="center">
          <template #default="{ row }">{{ row.order_count ?? 0 }}</template>
        </ElTableColumn>
        <ElTableColumn label="完成订单" width="100" align="center">
          <template #default="{ row }">{{ row.done_count ?? 0 }}</template>
        </ElTableColumn>
        <ElTableColumn label="累计消费" min-width="110" align="right">
          <template #default="{ row }">¥{{ formatMoney(row.total_spend) }}</template>
        </ElTableColumn>
        <ElTableColumn label="受限" width="76" align="center">
          <template #default="{ row }">
            <ElTooltip v-if="isRestricted(row as Customer)" :content="restrictedTip(row as Customer)" placement="top">
              <ElTag type="danger" size="small" effect="light">受限</ElTag>
            </ElTooltip>
            <span v-else class="sub-text">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="goOrders(row as Customer)">查看订单</ElButton>
            <ElButton
              v-if="isRestricted(row as Customer)"
              link
              type="success"
              size="small"
              @click="doUnrestrict(row as Customer)"
            >
              解除限制
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <!-- 分页 -->
    <div class="pagination-wrap">
      <ElPagination
        v-model:current-page="query.page"
        v-model:page-size="query.page_size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @size-change="load"
        @current-change="load"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Search } from '@element-plus/icons-vue'
import {
  ElButton,
  ElInput,
  ElPagination,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTooltip,
  ElMessage,
  ElMessageBox,
} from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchCustomers, unrestrictCustomer } from '@/api/modules/customer'
import type { Customer } from '@/api/types'
import { formatMoney, formatTime } from '@/utils/format'

const router = useRouter()

const loading = ref(false)
const list = ref<Customer[]>([])
const total = ref(0)
const query = reactive({
  keyword: '',
  page: 1,
  page_size: 10,
})

async function load() {
  loading.value = true
  try {
    const res = await fetchCustomers({
      keyword: query.keyword || undefined,
      page: query.page,
      page_size: query.page_size,
    })
    list.value = res.list ?? []
    total.value = res.total ?? 0
  } finally {
    loading.value = false
  }
}

function search() {
  query.page = 1
  load()
}

/** 查看该客户的订单 → 跳订单管理带手机号关键字 */
function goOrders(row: Customer) {
  router.push({ path: '/orders', query: { keyword: row.phone } })
}

// ---------- 阶段二：低分受限 ----------
/** 是否受限中（restricted=1） */
function isRestricted(row: Customer) {
  return Number(row.restricted) === 1
}

/** 受限 tooltip：原因 + 解除时间 */
function restrictedTip(row: Customer) {
  const reason = row.restricted_reason || '近5单平均评分3.0以下'
  const until = row.restricted_until ? `；解除时间 ${formatTime(row.restricted_until)}` : ''
  return `原因：${reason}${until}`
}

/** 手动解除下单限制 */
async function doUnrestrict(row: Customer) {
  try {
    await ElMessageBox.confirm(
      `确认解除客户「${row.name || row.phone}」的下单限制？`,
      '解除限制',
      { confirmButtonText: '解除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await unrestrictCustomer(row.id)
    ElMessage.success('已解除限制')
    load()
  } catch {
    // 错误已由 http 拦截器提示
  }
}

onMounted(load)
</script>

<style scoped>
.sub-text {
  color: #909399;
  font-size: 12px;
}
</style>
