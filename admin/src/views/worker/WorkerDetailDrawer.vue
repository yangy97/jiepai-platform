<template>
  <ElDrawer :model-value="visible" title="师傅详情" size="520px" @update:model-value="onClose">
    <div v-loading="loading">
      <template v-if="detail">
        <!-- 账号信息 -->
        <div class="detail-section">
          <div class="detail-section-title">账号信息</div>
          <div class="desc-grid">
            <div>
              <span class="label">姓名：</span>
              <span class="value">{{ detail.worker.real_name || detail.user?.name || '—' }}</span>
            </div>
            <div><span class="label">手机号：</span><span class="value">{{ detail.user?.phone || '—' }}</span></div>
            <div style="grid-column: 1 / -1">
              <span class="label">身份证号：</span>
              <span class="value">{{ detail.worker.id_card || '—' }}</span>
            </div>
            <div><span class="label">入驻时间：</span><span class="value">{{ formatTime(detail.worker.created_at) }}</span></div>
            <div>
              <span class="label">认证状态：</span>
              <ElTag :type="workerStatusTag(detail.worker.status)" size="small" effect="light">
                {{ workerStatusLabel(detail.worker.status) }}
              </ElTag>
            </div>
          </div>
        </div>

        <!-- 服务信息 -->
        <div class="detail-section">
          <div class="detail-section-title">服务信息</div>
          <div class="desc-grid">
            <div><span class="label">服务区域：</span><span class="value">{{ detail.worker.region || '—' }}</span></div>
            <div><span class="label">从业年限：</span><span class="value">{{ detail.worker.years ?? 0 }} 年</span></div>
            <div><span class="label">评分：</span><span class="value">{{ detail.worker.rating ?? '5.0' }}</span></div>
            <div><span class="label">累计接单：</span><span class="value">{{ detail.worker.order_count ?? 0 }}</span></div>
            <div><span class="label">累计完成：</span><span class="value">{{ detail.worker.done_count ?? 0 }}</span></div>
            <div style="grid-column: 1 / -1">
              <span class="label">技能标签：</span>
              <span class="value">
                <ElTag
                  v-for="s in skillNames"
                  :key="s"
                  size="small"
                  type="info"
                  effect="plain"
                  style="margin-right: 4px"
                >
                  {{ s }}
                </ElTag>
                <span v-if="!skillNames.length">—</span>
              </span>
            </div>
            <div style="grid-column: 1 / -1">
              <span class="label">个人简介：</span>
              <span class="value">{{ detail.worker.bio || '—' }}</span>
            </div>
          </div>
        </div>

        <!-- 审核记录 -->
        <div class="detail-section">
          <div class="detail-section-title">审核记录</div>
          <div class="desc-grid">
            <div>
              <span class="label">审核时间：</span>
              <span class="value">{{ formatTime(detail.worker.audited_at) }}</span>
            </div>
            <div style="grid-column: 1 / -1">
              <span class="label">审核备注：</span>
              <span class="value">{{ detail.worker.audit_remark || '—' }}</span>
            </div>
          </div>
        </div>
      </template>
      <ElEmpty v-else-if="!loading" description="师傅不存在" />
    </div>
  </ElDrawer>
</template>

<script setup lang="ts">
import { ElDrawer, ElEmpty, ElTag } from 'element-plus'
import { computed, ref, watch } from 'vue'
import { fetchCategories } from '@/api/modules/category'
import { fetchWorkerDetail } from '@/api/modules/worker'
import type { Category, WorkerDetail } from '@/api/types'
import { formatTime, workerStatusLabel, workerStatusTag } from '@/utils/format'

const props = defineProps<{
  visible: boolean
  workerId: number
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  changed: []
}>()

const loading = ref(false)
const detail = ref<WorkerDetail>()
const categories = ref<Category[]>([])

/** 技能标签：优先后端类目名，其次用类目表映射 skills 中的 id */
const skillNames = computed(() => {
  const w = detail.value?.worker
  if (!w) return []
  if (Array.isArray(w.skill_names) && w.skill_names.length) return w.skill_names
  if (!w.skills) return []
  return String(w.skills)
    .split(',')
    .map((id) => categories.value.find((c) => c.id === Number(id))?.name)
    .filter((n): n is string => !!n)
})

async function load() {
  if (!props.workerId) return
  loading.value = true
  try {
    detail.value = await fetchWorkerDetail(props.workerId)
  } finally {
    loading.value = false
  }
}

// 打开抽屉时加载详情与类目表
watch(
  () => [props.visible, props.workerId] as const,
  ([visible]) => {
    if (visible) {
      load()
      if (!categories.value.length) {
        fetchCategories()
          .then((res) => {
            categories.value = res.list ?? []
          })
          .catch(() => {})
      }
    }
  },
)

function onClose(v: boolean) {
  emit('update:visible', v)
}
</script>
