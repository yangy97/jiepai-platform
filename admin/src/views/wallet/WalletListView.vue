<template>
  <div class="page">
    <ElTabs v-model="activeTab">
      <!-- 师傅钱包 -->
      <ElTabPane label="师傅钱包" name="wallets">
        <div class="filter-bar">
          <ElInput
            v-model="walletQuery.keyword"
            placeholder="师傅姓名/手机号"
            clearable
            style="width: 220px"
            :prefix-icon="Search"
            @keyup.enter="searchWallets"
            @clear="searchWallets"
          />
          <ElButton type="primary" :icon="Search" @click="searchWallets">查询</ElButton>
        </div>
        <!-- 表格撑满剩余高度，表体在可视区内滚动 -->
        <div class="table-wrap">
          <ElTable v-loading="walletLoading" :data="wallets" empty-text="暂无钱包数据" style="width: 100%">
            <ElTableColumn label="姓名" width="120">
              <template #default="{ row }">{{ row.real_name || row.name || `用户#${row.user_id}` }}</template>
            </ElTableColumn>
            <ElTableColumn label="手机号" width="140">
              <template #default="{ row }">{{ row.phone || '—' }}</template>
            </ElTableColumn>
            <ElTableColumn label="余额" width="130" align="right">
              <template #default="{ row }">
                <span class="money">¥{{ formatMoney(row.balance) }}</span>
              </template>
            </ElTableColumn>
            <ElTableColumn label="累计收入" width="130" align="right">
              <template #default="{ row }">
                <span class="money income">+¥{{ formatMoney(row.income) }}</span>
              </template>
            </ElTableColumn>
            <ElTableColumn label="累计提现" min-width="130" align="right">
              <template #default="{ row }">
                <span class="money">¥{{ formatMoney(row.withdrawn) }}</span>
              </template>
            </ElTableColumn>
            <ElTableColumn label="更新时间" width="170">
              <template #default="{ row }">{{ formatTime(row.updated_at) }}</template>
            </ElTableColumn>
          </ElTable>
        </div>
        <div class="pagination-wrap">
          <ElPagination
            v-model:current-page="walletQuery.page"
            v-model:page-size="walletQuery.page_size"
            :total="walletTotal"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            @size-change="loadWallets"
            @current-change="loadWallets"
          />
        </div>
      </ElTabPane>

      <!-- 资金流水 -->
      <ElTabPane label="资金流水" name="logs">
        <div class="filter-bar">
          <ElInput
            v-model="logQuery.user_id"
            placeholder="用户 ID"
            clearable
            style="width: 160px"
            @keyup.enter="searchLogs"
            @clear="searchLogs"
          />
          <ElSelect v-model="logQuery.type" placeholder="全部类型" clearable style="width: 140px" @change="searchLogs">
            <ElOption label="收入" value="income" />
            <ElOption label="提现" value="withdraw" />
            <ElOption label="退款" value="refund" />
          </ElSelect>
          <ElButton type="primary" :icon="Search" @click="searchLogs">查询</ElButton>
        </div>
        <!-- 表格撑满剩余高度，表体在可视区内滚动 -->
        <div class="table-wrap">
          <ElTable v-loading="logLoading" :data="logs" empty-text="暂无流水" style="width: 100%">
            <ElTableColumn label="用户" width="130">
              <template #default="{ row }">{{ row.user_name || row.real_name || `用户#${row.user_id}` }}</template>
            </ElTableColumn>
            <ElTableColumn label="订单号" width="165">
              <template #default="{ row }">{{ row.order_no || (row.order_id ? `#${row.order_id}` : '—') }}</template>
            </ElTableColumn>
            <ElTableColumn label="类型" width="90" align="center">
              <template #default="{ row }">
                <ElTag :type="walletTypeTag(row.type)" size="small" effect="light">
                  {{ walletTypeLabel(row.type) }}
                </ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn label="金额" width="130" align="right">
              <template #default="{ row }">
                <span class="money" :class="Number(row.amount) >= 0 ? 'income' : 'expense'">
                  {{ signedMoney(row.amount) }}
                </span>
              </template>
            </ElTableColumn>
            <ElTableColumn label="余额后" width="120" align="right">
              <template #default="{ row }">¥{{ formatMoney(row.balance_after) }}</template>
            </ElTableColumn>
            <ElTableColumn prop="remark" label="备注" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || '—' }}</template>
            </ElTableColumn>
            <ElTableColumn label="时间" width="170">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </ElTableColumn>
          </ElTable>
        </div>
        <div class="pagination-wrap">
          <ElPagination
            v-model:current-page="logQuery.page"
            v-model:page-size="logQuery.page_size"
            :total="logTotal"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            @size-change="loadLogs"
            @current-change="loadLogs"
          />
        </div>
      </ElTabPane>
    </ElTabs>
  </div>
</template>

<script setup lang="ts">
import { Search } from '@element-plus/icons-vue'
import {
  ElButton,
  ElInput,
  ElOption,
  ElPagination,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTag,
} from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { fetchWalletLogs, fetchWallets } from '@/api/modules/wallet'
import type { Wallet, WalletLog } from '@/api/types'
import { formatMoney, formatTime, signedMoney, walletTypeLabel, walletTypeTag } from '@/utils/format'

const activeTab = ref('wallets')

// ---------- 师傅钱包 ----------
const walletLoading = ref(false)
const wallets = ref<Wallet[]>([])
const walletTotal = ref(0)
const walletQuery = reactive({
  keyword: '',
  page: 1,
  page_size: 10,
})

async function loadWallets() {
  walletLoading.value = true
  try {
    const res = await fetchWallets({
      keyword: walletQuery.keyword || undefined,
      page: walletQuery.page,
      page_size: walletQuery.page_size,
    })
    wallets.value = res.list ?? []
    walletTotal.value = res.total ?? 0
  } finally {
    walletLoading.value = false
  }
}

function searchWallets() {
  walletQuery.page = 1
  loadWallets()
}

// ---------- 资金流水 ----------
const logLoading = ref(false)
const logs = ref<WalletLog[]>([])
const logTotal = ref(0)
const logQuery = reactive({
  user_id: '',
  type: '',
  page: 1,
  page_size: 10,
})

async function loadLogs() {
  logLoading.value = true
  try {
    const res = await fetchWalletLogs({
      user_id: logQuery.user_id || undefined,
      type: logQuery.type || undefined,
      page: logQuery.page,
      page_size: logQuery.page_size,
    })
    logs.value = res.list ?? []
    logTotal.value = res.total ?? 0
  } finally {
    logLoading.value = false
  }
}

function searchLogs() {
  logQuery.page = 1
  loadLogs()
}

onMounted(() => {
  loadWallets()
  loadLogs()
})
</script>

<style scoped>
.money {
  font-weight: 600;
}

.money.income {
  color: #52c41a;
}

.money.expense {
  color: #f56c6c;
}
</style>
