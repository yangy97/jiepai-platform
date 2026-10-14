<template>
  <div class="page">
    <!-- 筛选区 -->
    <div class="filter-bar">
      <ElSelect v-model="query.status" placeholder="全部认证状态" clearable style="width: 150px" @change="search">
        <ElOption v-for="(meta, value) in WORKER_STATUS_META" :key="value" :label="meta.label" :value="value" />
      </ElSelect>
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

    <!-- 师傅表格：撑满剩余高度，表体在可视区内滚动 -->
    <div class="table-wrap">
      <ElTable v-loading="loading" :data="list" empty-text="暂无师傅" style="width: 100%">
        <ElTableColumn label="姓名" width="110">
          <template #default="{ row }">{{ row.real_name || row.name || `师傅#${row.id}` }}</template>
        </ElTableColumn>
        <ElTableColumn label="手机号" width="130">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </ElTableColumn>
        <ElTableColumn prop="region" label="服务区域" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.region || '—' }}</template>
        </ElTableColumn>
        <ElTableColumn label="技能标签" min-width="160">
          <template #default="{ row }">
            <ElTag v-for="s in workerSkillText(row as Worker)" :key="s" size="small" type="info" effect="plain" style="margin-right: 4px">
              {{ s }}
            </ElTag>
            <span v-if="!workerSkillText(row as Worker).length" class="sub-text">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="years" label="从业年限" width="90" align="center">
          <template #default="{ row }">{{ row.years ?? 0 }} 年</template>
        </ElTableColumn>
        <ElTableColumn prop="rating" label="评分" width="80" align="center">
          <template #default="{ row }">{{ row.rating ?? '5.0' }}</template>
        </ElTableColumn>
        <ElTableColumn prop="order_count" label="累计接单" width="90" align="center">
          <template #default="{ row }">{{ row.order_count ?? 0 }}</template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="92" align="center">
          <template #default="{ row }">
            <ElTag :type="workerStatusTag(row.status)" size="small" effect="light">
              {{ workerStatusLabel(row.status) }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="受限" width="76" align="center">
          <template #default="{ row }">
            <ElTooltip v-if="isRestricted(row as Worker)" :content="restrictedTip(row as Worker)" placement="top">
              <ElTag type="danger" size="small" effect="light">受限</ElTag>
            </ElTooltip>
            <span v-else class="sub-text">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="入驻时间" width="160">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openDetail(row as Worker)">详情</ElButton>
            <ElButton
              v-if="row.status === 'pending' || row.status === 'rejected'"
              link
              type="warning"
              size="small"
              @click="openAudit(row as Worker)"
            >
              审核
            </ElButton>
            <ElButton
              v-if="row.status === 'approved' || row.status === 'pending'"
              link
              type="danger"
              size="small"
              @click="toggleDisable(row as Worker)"
            >
              停用
            </ElButton>
            <ElButton
              v-if="row.status === 'disabled'"
              link
              type="success"
              size="small"
              @click="toggleDisable(row as Worker)"
            >
              启用
            </ElButton>
            <ElButton
              v-if="isRestricted(row as Worker)"
              link
              type="success"
              size="small"
              @click="doUnrestrict(row as Worker)"
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

    <!-- 审核弹窗 -->
    <ElDialog v-model="auditVisible" title="师傅认证审核" width="460px" destroy-on-close>
      <ElForm label-width="80px">
        <ElFormItem label="审核结果">
          <ElRadioGroup v-model="auditForm.status">
            <ElRadioButton value="approved">通过</ElRadioButton>
            <ElRadioButton value="rejected">驳回</ElRadioButton>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem label="审核备注">
          <ElInput v-model="auditForm.remark" type="textarea" :rows="3" placeholder="选填，驳回时建议填写原因" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="auditVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="auditing" @click="submitAudit">提交审核</ElButton>
      </template>
    </ElDialog>

    <!-- 师傅详情抽屉 -->
    <WorkerDetailDrawer v-model:visible="detailVisible" :worker-id="detailWorkerId" @changed="load" />
  </div>
</template>

<script setup lang="ts">
import { Search } from '@element-plus/icons-vue'
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElPagination,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTooltip,
  ElMessageBox,
  ElMessage,
} from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { fetchCategories } from '@/api/modules/category'
import { auditWorker, fetchWorkers, unrestrictWorker, updateWorkerStatus } from '@/api/modules/worker'
import type { Category, Worker } from '@/api/types'
import { WORKER_STATUS_META } from '@/constants/worker.constants'
import { formatTime, workerStatusLabel, workerStatusTag } from '@/utils/format'
import WorkerDetailDrawer from './WorkerDetailDrawer.vue'

// ---------- 列表 ----------
const loading = ref(false)
const list = ref<Worker[]>([])
const total = ref(0)
const categories = ref<Category[]>([])
const query = reactive({
  status: '',
  keyword: '',
  page: 1,
  page_size: 10,
})

/** 技能标签展示（优先后端类目名，其次用类目表映射 id） */
function workerSkillText(w: Worker): string[] {
  if (Array.isArray(w.skill_names) && w.skill_names.length) return w.skill_names
  if (!w.skills) return []
  return String(w.skills)
    .split(',')
    .map((id) => categories.value.find((c) => c.id === Number(id))?.name)
    .filter((n): n is string => !!n)
}

async function load() {
  loading.value = true
  try {
    const res = await fetchWorkers({
      status: query.status || undefined,
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

// ---------- 详情 ----------
const detailVisible = ref(false)
const detailWorkerId = ref(0)

function openDetail(row: Worker) {
  detailWorkerId.value = row.id
  detailVisible.value = true
}

// ---------- 审核 ----------
const auditVisible = ref(false)
const auditing = ref(false)
const auditForm = reactive({
  workerId: 0,
  status: 'approved' as 'approved' | 'rejected',
  remark: '',
})

function openAudit(row: Worker) {
  auditForm.workerId = row.id
  auditForm.status = 'approved'
  auditForm.remark = ''
  auditVisible.value = true
}

async function submitAudit() {
  auditing.value = true
  try {
    await auditWorker(auditForm.workerId, auditForm.status, auditForm.remark || undefined)
    ElMessage.success(auditForm.status === 'approved' ? '已通过认证' : '已驳回')
    auditVisible.value = false
    load()
  } finally {
    auditing.value = false
  }
}

// ---------- 停用 / 启用 ----------
async function toggleDisable(row: Worker) {
  const disabling = row.status !== 'disabled'
  try {
    await ElMessageBox.confirm(
      disabling ? `确认停用师傅「${row.real_name || row.name || row.id}」？停用后将无法接单。` : '确认启用该师傅？',
      disabling ? '停用师傅' : '启用师傅',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  await updateWorkerStatus(row.id, disabling ? 'disabled' : 'enabled')
  ElMessage.success(disabling ? '已停用' : '已启用')
  load()
}

// ---------- 阶段二：低分受限 ----------
/** 是否受限中（restricted=1） */
function isRestricted(row: Worker) {
  return Number(row.restricted) === 1
}

/** 受限 tooltip：原因 + 解除时间 */
function restrictedTip(row: Worker) {
  const reason = row.restricted_reason || '近5单平均评分3.0以下'
  const until = row.restricted_until ? `；解除时间 ${formatTime(row.restricted_until)}` : ''
  return `原因：${reason}${until}`
}

/** 手动解除接单限制 */
async function doUnrestrict(row: Worker) {
  try {
    await ElMessageBox.confirm(
      `确认解除「${row.real_name || row.name || `师傅#${row.id}`}」的接单限制？`,
      '解除限制',
      { confirmButtonText: '解除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await unrestrictWorker(row.id)
    ElMessage.success('已解除限制')
    load()
  } catch {
    // 错误已由 http 拦截器提示
  }
}

// ---------- 初始化 ----------
onMounted(async () => {
  try {
    const res = await fetchCategories()
    categories.value = res.list ?? []
  } catch {
    // 类目加载失败不影响列表展示
  }
  load()
})
</script>

<style scoped>
.sub-text {
  color: #909399;
  font-size: 12px;
}
</style>
