<template>
  <ElDrawer
    :model-value="visible"
    title="订单详情"
    size="560px"
    @update:model-value="onClose"
  >
    <div v-loading="loading">
      <template v-if="detail">
        <!-- 基础信息 -->
        <div class="detail-section">
          <div class="detail-section-title">基础信息</div>
          <div class="desc-grid">
            <div>
              <span class="label">订单号：</span>
              <span class="value">{{ detail.order.order_no }}</span>
              <ElButton link type="primary" size="small" style="margin-left: 4px" @click="copyOrderNo">
                复制
              </ElButton>
            </div>
            <div>
              <span class="label">状态：</span>
              <ElTag :type="orderStatusTag(detail.order.status)" size="small" effect="light">
                {{ orderStatusLabel(detail.order.status) }}
              </ElTag>
              <ElTag
                v-if="detail.order.pay_status"
                :type="payStatusTag(detail.order.pay_status)"
                size="small"
                effect="plain"
                style="margin-left: 6px"
              >
                {{ detail.order.pay_status_text || payStatusLabel(detail.order.pay_status) }}
              </ElTag>
            </div>
            <div><span class="label">标题：</span><span class="value">{{ detail.order.title || '—' }}</span></div>
            <div>
              <span class="label">类目：</span>
              <span class="value">{{ catInfo.icon }} {{ catInfo.text }}</span>
              <ElTag v-if="catInfo.custom" type="warning" size="small" effect="plain" style="margin-left: 6px">
                自定义
              </ElTag>
            </div>
            <div><span class="label">下单时间：</span><span class="value">{{ formatTime(detail.order.created_at) }}</span></div>
            <div><span class="label">期望上门：</span><span class="value">{{ formatTime(detail.order.expect_at) }}</span></div>
            <div style="grid-column: 1 / -1">
              <span class="label">地址：</span><span class="value">{{ detail.order.address || '—' }}</span>
              <template v-if="detail.order.lng != null && detail.order.lat != null">
                <span class="coord-text">经度 {{ detail.order.lng }} / 纬度 {{ detail.order.lat }}</span>
                <a
                  class="location-link"
                  :href="amapLink"
                  target="_blank"
                  rel="noopener"
                >
                  查看位置
                </a>
              </template>
            </div>
            <div v-if="detail.order.custom_category" style="grid-column: 1 / -1">
              <span class="label">自定义类型：</span><span class="value">{{ detail.order.custom_category }}</span>
            </div>
            <div style="grid-column: 1 / -1">
              <span class="label">描述：</span><span class="value">{{ detail.order.description || '—' }}</span>
            </div>
            <div v-if="detail.order.cancel_reason" style="grid-column: 1 / -1">
              <span class="label">取消原因：</span>
              <span class="value" style="color: #f56c6c">{{ detail.order.cancel_reason }}</span>
            </div>
            <div v-if="detail.order.finish_remark" style="grid-column: 1 / -1">
              <span class="label">完工备注：</span><span class="value">{{ detail.order.finish_remark }}</span>
            </div>
          </div>
        </div>

        <!-- 客户 / 师傅 -->
        <div class="detail-section">
          <div class="detail-section-title">客户与师傅</div>
          <div class="desc-grid">
            <div>
              <span class="label">客户：</span>
              <span class="value">{{ detail.customer?.name || `客户#${detail.order.customer_id}` }}</span>
            </div>
            <div><span class="label">客户手机：</span><span class="value">{{ detail.customer?.phone || '—' }}</span></div>
            <div>
              <span class="label">师傅：</span>
              <span class="value">
                {{ detail.worker ? (detail.worker.real_name || detail.worker.name || `师傅#${detail.worker.id}`) : '待派单' }}
              </span>
            </div>
            <div><span class="label">师傅手机：</span><span class="value">{{ detail.worker?.phone || '—' }}</span></div>
            <div v-if="detail.worker?.region"><span class="label">服务区域：</span><span class="value">{{ detail.worker.region }}</span></div>
            <div v-if="detail.worker?.rating != null">
              <span class="label">师傅评分：</span><span class="value">{{ detail.worker.rating }}</span>
            </div>
          </div>
        </div>

        <!-- 金额明细 -->
        <div class="detail-section">
          <div class="detail-section-title">金额明细</div>
          <div class="desc-grid">
            <div><span class="label">客户预算：</span><span class="value">¥{{ formatMoney(detail.order.budget) }}</span></div>
            <div>
              <span class="label">结算金额：</span>
              <span class="value">¥{{ formatMoney(detail.order.price) }}</span>
            </div>
            <div>
              <span class="label">平台服务费：</span>
              <span class="value">¥{{ formatMoney(detail.order.service_fee) }}</span>
            </div>
            <div>
              <span class="label">师傅实收：</span>
              <span class="value">¥{{ formatMoney(Number(detail.order.price) - Number(detail.order.service_fee)) }}</span>
            </div>
          </div>
        </div>

        <!-- 资金信息（阶段二：支付/实收/退款明细，字段兜底） -->
        <div class="detail-section">
          <div class="detail-section-title">资金信息</div>
          <div class="desc-grid">
            <div>
              <span class="label">支付金额：</span>
              <span class="value">{{ isPaid ? `¥${formatMoney(paidAmount)}` : '—' }}</span>
            </div>
            <div>
              <span class="label">支付时间：</span>
              <span class="value">{{ formatTime(detail.order.paid_at) }}</span>
            </div>
            <div v-if="detail.order.transaction_id" style="grid-column: 1 / -1">
              <span class="label">交易单号：</span>
              <span class="value">{{ detail.order.transaction_id }}</span>
            </div>
            <div v-if="actualFee > 0">
              <span class="label">实收金额：</span>
              <span class="value" style="color: #67c23a; font-weight: 600">¥{{ formatMoney(actualFee) }}</span>
            </div>
            <div>
              <span class="label">退款政策：</span>
              <ElTag :type="refundPolicyTag(detail.order.refund_policy)" size="small" effect="plain">
                {{ refundPolicyLabel(detail.order.refund_policy) || '支持中途退款' }}
              </ElTag>
            </div>
            <div>
              <span class="label">计费方式：</span>
              <span class="value">{{ billingText(detail.order.billing_type, detail.order.hourly_price) }}</span>
            </div>
            <!-- 退款明细（已退款时展示） -->
            <template v-if="isRefunded">
              <div>
                <span class="label">退款金额：</span>
                <span class="value" style="color: #f56c6c; font-weight: 600">¥{{ formatMoney(refundAmount) }}</span>
              </div>
              <div>
                <span class="label">退款时间：</span>
                <span class="value">{{ formatTime(detail.order.refunded_at) }}</span>
              </div>
              <div v-if="detail.order.refund_reason" style="grid-column: 1 / -1">
                <span class="label">退款原因：</span>
                <span class="value">{{ detail.order.refund_reason }}</span>
              </div>
              <div v-if="detail.order.refund_id" style="grid-column: 1 / -1">
                <span class="label">退款单号：</span>
                <span class="value">{{ detail.order.refund_id }}</span>
              </div>
            </template>
            <!-- 中途结束明细 -->
            <template v-if="detail.order.status === 'aborted'">
              <div style="grid-column: 1 / -1">
                <span class="label">开工 → 中止：</span>
                <span class="value">{{ formatTime(detail.order.started_at) }} → {{ formatTime(detail.order.aborted_at) }}</span>
              </div>
              <div>
                <span class="label">服务时长：</span>
                <span class="value">{{ abortMinutes != null ? `${abortMinutes} 分钟` : '—' }}</span>
              </div>
              <div style="grid-column: 1 / -1">
                <span class="label">中止原因：</span>
                <span class="value" style="color: #f56c6c">{{ detail.order.abort_reason || '—' }}</span>
              </div>
            </template>
          </div>
        </div>

        <!-- 评价（阶段二：客户评师傅 + 师傅回评客户，有值才渲染） -->
        <div v-if="hasCustomerRate || hasWorkerRate" class="detail-section">
          <div class="detail-section-title">评价</div>

          <!-- 客户 → 师傅 -->
          <div v-if="hasCustomerRate" class="rate-block">
            <div class="rate-head">
              <span class="rate-head-title">客户评价</span>
              <ElRate :model-value="Number(detail.order.rating)" disabled />
              <span class="rate-score">{{ Number(detail.order.rating) }} 分</span>
            </div>
            <div v-if="rateSkill || rateAttitude || ratePunctual" class="rate-dims">
              <div v-if="rateSkill" class="rate-dim"><span>技术</span><ElRate :model-value="rateSkill" disabled /></div>
              <div v-if="rateAttitude" class="rate-dim"><span>态度</span><ElRate :model-value="rateAttitude" disabled /></div>
              <div v-if="ratePunctual" class="rate-dim"><span>准时</span><ElRate :model-value="ratePunctual" disabled /></div>
            </div>
            <div v-if="rateTags.length" class="rate-tags">
              <ElTag v-for="t in rateTags" :key="t" size="small" type="success" effect="plain">{{ t }}</ElTag>
            </div>
            <div v-if="detail.order.rate_comment" class="rate-comment">{{ detail.order.rate_comment }}</div>
          </div>

          <!-- 师傅 → 客户 -->
          <div v-if="hasWorkerRate" class="rate-block">
            <div class="rate-head">
              <span class="rate-head-title">师傅评价客户</span>
              <ElRate :model-value="Number(detail.order.worker_rating)" disabled />
              <span class="rate-score">{{ Number(detail.order.worker_rating) }} 分</span>
            </div>
            <div v-if="workerRateTags.length" class="rate-tags">
              <ElTag v-for="t in workerRateTags" :key="t" size="small" type="warning" effect="plain">{{ t }}</ElTag>
            </div>
            <div v-if="detail.order.worker_rate_comment" class="rate-comment">
              {{ detail.order.worker_rate_comment }}
            </div>
          </div>
        </div>

        <!-- 操作时间线 -->
        <div class="detail-section">
          <div class="detail-section-title">操作时间线</div>
          <ElTimeline v-if="detail.logs?.length">
            <ElTimelineItem
              v-for="log in detail.logs"
              :key="log.id"
              :timestamp="formatTime(log.created_at)"
              placement="top"
            >
              <div class="log-content">{{ log.content || log.action }}</div>
              <div class="log-meta">{{ roleText(log.operator_role) }}{{ log.operator_name ? ` · ${log.operator_name}` : '' }}</div>
            </ElTimelineItem>
          </ElTimeline>
          <ElEmpty v-else description="暂无操作记录" :image-size="70" />
        </div>

        <!-- 底部操作按钮（按状态） -->
        <div class="drawer-actions">
          <ElButton
            v-if="detail.order.status === 'pending' || detail.order.status === 'dispatched'"
            type="primary"
            @click="emit('dispatch', detail.order)"
          >
            {{ detail.order.status === 'dispatched' ? '改派师傅' : '派单' }}
          </ElButton>
          <ElButton
            v-if="detail.order.status === 'accepted'"
            type="primary"
            @click="doAction('start')"
          >
            开始服务
          </ElButton>
          <ElButton
            v-if="detail.order.status === 'working'"
            type="primary"
            @click="openFinish"
          >
            填写完工金额并完成
          </ElButton>
          <ElButton
            v-if="detail.order.status === 'aborted'"
            type="primary"
            :loading="handling"
            @click="doAction('confirm')"
          >
            确认结算 ¥{{ formatMoney(actualFee) }}
          </ElButton>
          <ElButton
            v-if="detail.order.status === 'finished'"
            type="primary"
            @click="doAction('confirm')"
          >
            确认完成
          </ElButton>
          <ElButton
            v-if="detail.order.status === 'working'"
            type="danger"
            plain
            @click="openAbort"
          >
            中途结束
          </ElButton>
          <ElButton
            v-if="['pending', 'dispatched', 'accepted', 'working'].includes(detail.order.status)"
            type="danger"
            plain
            @click="doCancel"
          >
            取消订单
          </ElButton>
          <ElButton
            v-if="detail.order.pay_status === 'paid' && detail.order.status !== 'completed'"
            type="warning"
            plain
            :loading="refunding"
            @click="doRefund"
          >
            退款
          </ElButton>
        </div>
      </template>
      <ElEmpty v-else-if="!loading" description="订单不存在或已删除" />
    </div>

    <!-- 完工金额弹窗 -->
    <ElDialog v-model="finishVisible" title="填写完工金额" width="440px" append-to-body destroy-on-close>
      <ElForm label-width="90px">
        <ElFormItem label="结算金额">
          <ElInputNumber v-model="finishPrice" :min="0" :precision="2" :step="10" style="width: 180px" />
        </ElFormItem>
        <ElFormItem label="完工备注">
          <ElInput v-model="finishRemark" type="textarea" :rows="2" placeholder="选填" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="finishVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="handling" @click="submitFinish">提交完工</ElButton>
      </template>
    </ElDialog>

    <!-- 中途结束弹窗（working → aborted：原因必填，一口价单填实收，时薪单服务端按时长自动算） -->
    <ElDialog v-model="abortVisible" title="中途结束" width="460px" append-to-body destroy-on-close>
      <ElForm label-width="90px">
        <ElFormItem label="结束原因" required>
          <ElInput
            v-model="abortForm.reason"
            type="textarea"
            :rows="3"
            maxlength="255"
            placeholder="必填，说明服务为何提前终止"
          />
        </ElFormItem>
        <ElFormItem v-if="isHourly" label="计费方式">
          <span class="dialog-tip">时薪单由服务端按时长自动计算实收（半小时向上取整）</span>
        </ElFormItem>
        <ElFormItem v-else label="实收金额" required>
          <ElInputNumber v-model="abortForm.price" :min="0" :precision="2" :step="10" style="width: 180px" />
          <div class="dialog-tip">一口价单需填写实收，客户确认后按此金额结算</div>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="abortVisible = false">取消</ElButton>
        <ElButton type="danger" :loading="aborting" @click="submitAbort">提交中途结束</ElButton>
      </template>
    </ElDialog>

    <!-- 手动退款弹窗（金额 + 原因，留审计日志） -->
    <ElDialog v-model="refundVisible" title="手动退款" width="460px" append-to-body destroy-on-close>
      <ElForm label-width="90px">
        <ElFormItem label="退款金额" required>
          <ElInputNumber
            v-model="refundForm.amount"
            :min="0.01"
            :max="paidAmount > 0 ? paidAmount : undefined"
            :precision="2"
            :step="10"
            style="width: 180px"
          />
          <div class="dialog-tip">默认全额，最多可退 ¥{{ formatMoney(paidAmount) }}</div>
        </ElFormItem>
        <ElFormItem label="退款原因">
          <ElInput
            v-model="refundForm.reason"
            type="textarea"
            :rows="2"
            maxlength="255"
            placeholder="选填，写入审计日志"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="refundVisible = false">取消</ElButton>
        <ElButton type="warning" plain :loading="refunding" @click="submitRefund">确认退款</ElButton>
      </template>
    </ElDialog>
  </ElDrawer>
</template>

<script setup lang="ts">
import {
  ElButton,
  ElDialog,
  ElDrawer,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElRate,
  ElTimeline,
  ElTimelineItem,
  ElTag,
  ElMessageBox,
} from 'element-plus'
import { ref, watch, computed, reactive } from 'vue'
import { abortOrder, fetchOrderDetail, handleOrder, refundOrder } from '@/api/modules/order'
import type { Order, OrderDetail } from '@/api/types'
import {
  billingText,
  categoryLabel,
  formatMoney,
  formatTime,
  orderStatusLabel,
  orderStatusTag,
  payStatusLabel,
  payStatusTag,
  refundPolicyLabel,
  refundPolicyTag,
} from '@/utils/format'

const props = defineProps<{
  visible: boolean
  orderId: number
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  /** 订单被操作（派单/状态流转）后，通知父级刷新列表 */
  changed: []
  /** 请求派单：由父级打开派单弹窗 */
  dispatch: [order: Order]
}>()

const loading = ref(false)
const detail = ref<OrderDetail>()
const handling = ref(false)
const refunding = ref(false)

const finishVisible = ref(false)
const finishPrice = ref<number>()
const finishRemark = ref('')

// ---------- 阶段二：中途结束 ----------
const abortVisible = ref(false)
const aborting = ref(false)
const abortForm = reactive({
  reason: '',
  /** 实收金额（仅一口价单需填） */
  price: undefined as number | undefined,
})

// ---------- 阶段二：手动退款（金额 + 原因） ----------
const refundVisible = ref(false)
const refundForm = reactive({
  amount: undefined as number | undefined,
  reason: '',
})

/** 类目展示信息：兼容自定义类型（is_custom 旧数据可能为 undefined） */
const catInfo = computed(() => {
  const order = detail.value?.order
  const cat = detail.value?.category
  const label = categoryLabel(order)
  const text = label.text !== '—' ? label.text : cat?.name || '—'
  const icon = label.custom ? '📋' : cat?.icon || order?.category_icon || '🔧'
  return { icon, text, custom: label.custom }
})

/** 高德 URI（免 key）查看订单位置 */
const amapLink = computed(() => {
  const order = detail.value?.order
  if (!order || order.lng == null || order.lat == null) return ''
  return `https://uri.amap.com/marker?position=${order.lng},${order.lat}&name=${encodeURIComponent(order.address || '')}`
})

/** 订单快捷引用（字段兜底） */
const order = computed(() => detail.value?.order)

/** 是否已支付（已退款也算发生过支付） */
const isPaid = computed(() => ['paid', 'refunded'].includes(order.value?.pay_status ?? ''))

/** 支付金额（服务端以 budget 收款，老数据兜底取结算金额） */
const paidAmount = computed(() => {
  const o = order.value
  if (!o) return 0
  const budget = Number(o.budget) || 0
  return budget > 0 ? budget : Number(o.price) || 0
})

/** 实收金额（aborted 中途结算 / completed 已结算时有值） */
const actualFee = computed(() => Number(order.value?.actual_fee) || 0)

/** 是否已退款 */
const isRefunded = computed(
  () => order.value?.pay_status === 'refunded' || Number(order.value?.refund_amount) > 0,
)

/** 退款金额（老数据未落 refund_amount 时按全额兜底） */
const refundAmount = computed(() => {
  const amount = Number(order.value?.refund_amount) || 0
  return amount > 0 ? amount : paidAmount.value
})

/** 是否时薪单（中途结束时实收由服务端按时长公式自动算） */
const isHourly = computed(() => order.value?.billing_type === 'hourly')

/** 开工 → 中止的服务时长（分钟） */
const abortMinutes = computed(() => {
  const o = order.value
  if (!o?.started_at || !o.aborted_at) return null
  const t1 = new Date(String(o.started_at).replace(' ', 'T')).getTime()
  const t2 = new Date(String(o.aborted_at).replace(' ', 'T')).getTime()
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null
  return Math.max(0, Math.round((t2 - t1) / 60000))
})

/** 客户是否评过分（有值才渲染评价区） */
const hasCustomerRate = computed(() => Number(order.value?.rating ?? 0) > 0)

/** 三维度评分（可能只评总分，维度缺省 0 时隐藏该行） */
const rateSkill = computed(() => Number(order.value?.rate_skill ?? 0) || 0)
const rateAttitude = computed(() => Number(order.value?.rate_attitude ?? 0) || 0)
const ratePunctual = computed(() => Number(order.value?.rate_punctual ?? 0) || 0)

/** 师傅是否回评过客户 */
const hasWorkerRate = computed(() => Number(order.value?.worker_rating ?? 0) > 0)

/** 评价标签：逗号分隔字符串 → 数组 */
const rateTags = computed(() => splitTags(order.value?.rate_tags))
const workerRateTags = computed(() => splitTags(order.value?.worker_rate_tags))

/** 标签串拆分（空值兜底空数组） */
function splitTags(v?: string | null): string[] {
  return v
    ? String(v)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
}

/** 加载订单详情 */
async function load() {
  if (!props.orderId) return
  loading.value = true
  try {
    detail.value = await fetchOrderDetail(props.orderId)
  } finally {
    loading.value = false
  }
}

// 打开抽屉时加载
watch(
  () => [props.visible, props.orderId] as const,
  ([visible]) => {
    if (visible) load()
  },
)

function onClose(v: boolean) {
  emit('update:visible', v)
}

/** 复制订单号 */
async function copyOrderNo() {
  const no = detail.value?.order.order_no
  if (!no) return
  try {
    await navigator.clipboard.writeText(no)
    ElMessage.success('订单号已复制')
  } catch {
    ElMessage.info(`订单号：${no}`)
  }
}

/** 操作人角色文案 */
function roleText(role: string) {
  if (role === 'admin') return '运营'
  if (role === 'worker') return '师傅'
  if (role === 'customer') return '客户'
  return role || '系统'
}

/** 代操作 */
async function doAction(action: 'start' | 'confirm') {
  const texts: Record<string, string> = {
    start: '已开始服务',
    // aborted 态的 confirm 是「确认结算」，finished 态是「确认完成」
    confirm:
      order.value?.status === 'aborted' ? '已确认结算，师傅钱包入账' : '已确认完成，师傅钱包入账',
  }
  handling.value = true
  try {
    await handleOrder(props.orderId, { action })
    ElMessage.success(texts[action])
    load()
    emit('changed')
  } finally {
    handling.value = false
  }
}

/** 打开手动退款弹窗（金额默认全额、上限支付金额） */
function doRefund() {
  refundForm.amount = paidAmount.value > 0 ? paidAmount.value : undefined
  refundForm.reason = ''
  refundVisible.value = true
}

/** 提交手动退款：POST /api/admin/orders/:id/refund { amount, reason } */
async function submitRefund() {
  const amount = Number(refundForm.amount)
  if (!(amount > 0)) {
    ElMessage.warning('请填写大于 0 的退款金额')
    return
  }
  if (amount > paidAmount.value) {
    ElMessage.warning(`退款金额不能超过支付金额 ¥${formatMoney(paidAmount.value)}`)
    return
  }
  refunding.value = true
  try {
    await refundOrder(props.orderId, { amount, reason: refundForm.reason || undefined })
    ElMessage.success('退款成功')
    refundVisible.value = false
    load()
    emit('changed')
  } finally {
    refunding.value = false
  }
}

/** 打开中途结束弹窗：一口价单预填实收（默认结算金额/预算），时薪单由服务端自动算 */
function openAbort() {
  const o = order.value
  abortForm.reason = ''
  abortForm.price = o ? (Number(o.price) > 0 ? Number(o.price) : Number(o.budget) || undefined) : undefined
  abortVisible.value = true
}

/** 提交中途结束：POST /api/orders/:id/abort { reason, price? } */
async function submitAbort() {
  const reason = abortForm.reason.trim()
  if (!reason) {
    ElMessage.warning('请填写结束原因')
    return
  }
  if (!isHourly.value && !(Number(abortForm.price) >= 0)) {
    ElMessage.warning('请填写实收金额')
    return
  }
  aborting.value = true
  try {
    await abortOrder(props.orderId, {
      reason,
      price: isHourly.value ? undefined : Number(abortForm.price),
    })
    ElMessage.success('已中途结束，待客户确认实收')
    abortVisible.value = false
    load()
    emit('changed')
  } finally {
    aborting.value = false
  }
}

/** 打开完工弹窗，预填结算金额 */
function openFinish() {
  const order = detail.value?.order
  finishPrice.value = order && Number(order.price) > 0 ? Number(order.price) : Number(order?.budget ?? 0)
  finishRemark.value = ''
  finishVisible.value = true
}

async function submitFinish() {
  if (finishPrice.value == null) {
    ElMessage.warning('请填写结算金额')
    return
  }
  handling.value = true
  try {
    await handleOrder(props.orderId, {
      action: 'finish',
      price: finishPrice.value,
      remark: finishRemark.value || undefined,
    })
    ElMessage.success('完工信息已提交，订单进入待确认')
    finishVisible.value = false
    load()
    emit('changed')
  } finally {
    handling.value = false
  }
}

/** 取消订单（填原因） */
async function doCancel() {
  try {
    const { value } = await ElMessageBox.prompt('请输入取消原因', '取消订单', {
      confirmButtonText: '确认取消',
      cancelButtonText: '再想想',
      inputValidator: (v: string) => (!!v && !!v.trim()) || '取消原因不能为空',
    })
    handling.value = true
    try {
      await handleOrder(props.orderId, { action: 'cancel', reason: value })
      ElMessage.success('订单已取消')
      load()
      emit('changed')
    } finally {
      handling.value = false
    }
  } catch {
    // 用户放弃
  }
}
</script>

<style scoped>
.log-content {
  font-size: 13px;
  color: #303133;
}

/* 地址行坐标小字 */
.coord-text {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}

/* 查看位置链接 */
.location-link {
  margin-left: 8px;
  font-size: 12px;
  color: var(--jp-primary, #1890ff);
  text-decoration: none;
}

.location-link:hover {
  text-decoration: underline;
}

.log-meta {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.drawer-actions {
  position: sticky;
  bottom: 0;
  padding: 10px 0;
  background: #fff;
  border-top: 1px solid #ebeef5;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 弹窗内提示小字 */
.dialog-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

/* 评价区块 */
.rate-block {
  padding: 10px 12px;
  background: #fafafa;
  border-radius: 6px;
  margin-bottom: 10px;
}

.rate-block:last-child {
  margin-bottom: 0;
}

.rate-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rate-head-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.rate-score {
  font-size: 13px;
  color: #fa8c16;
}

.rate-dims {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.rate-dim {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #909399;
}

.rate-dim .el-rate {
  transform: scale(0.8);
  transform-origin: left center;
}

.rate-tags {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.rate-comment {
  margin-top: 6px;
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
}
</style>
