<template>
  <div class="page">
    <!-- 筛选区 -->
    <div class="filter-bar">
      <ElSelect v-model="query.status" placeholder="全部状态" clearable style="width: 140px" @change="search">
        <ElOption v-for="opt in ORDER_STATUS_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
      </ElSelect>
      <ElInput
        v-model="query.keyword"
        placeholder="订单号/标题/手机号/地址，回车查询"
        clearable
        style="width: 260px"
        :prefix-icon="Search"
        @keyup.enter="search"
        @clear="search"
      />
      <ElButton type="primary" :icon="Search" @click="search">查询</ElButton>
      <ElButton type="success" :icon="Plus" @click="openCreate">新建订单</ElButton>
    </div>

    <!-- 订单表格：撑满剩余高度，表体在可视区内滚动 -->
    <div class="table-wrap">
      <ElTable v-loading="loading" :data="list" empty-text="暂无订单" style="width: 100%">
        <ElTableColumn prop="order_no" label="订单号" width="165" />
        <ElTableColumn label="类目" width="140">
          <template #default="{ row }">
            <div class="cat-cell">
              <span>{{ row.category_icon || '🔧' }} {{ categoryLabel(row).text }}</span>
              <ElTag v-if="categoryLabel(row).custom" type="warning" size="small" effect="plain">自定义</ElTag>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="title" label="标题" min-width="130" show-overflow-tooltip />
        <ElTableColumn label="客户" width="130">
          <template #default="{ row }">
            <div>{{ row.customer_name || `客户#${row.customer_id}` }}</div>
            <div class="sub-text">{{ maskPhone(row.customer_phone) }}</div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="师傅" width="130">
          <template #default="{ row }">
            <template v-if="row.worker_id">
              <div>{{ row.worker_name || `师傅#${row.worker_id}` }}</div>
              <div class="sub-text">{{ maskPhone(row.worker_phone) }}</div>
            </template>
            <ElTag v-else type="warning" size="small" effect="plain">待派单</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="金额" width="100" align="right">
          <template #default="{ row }">
            <!-- 时薪单直接展示时薪单价，一口价单展示结算/预算 -->
            <span v-if="isHourlyOrder(row as Order)">¥{{ formatMoney(row.hourly_price) }}/h</span>
            <span v-else-if="Number(row.price) > 0">¥{{ formatMoney(row.price) }}</span>
            <span v-else class="sub-text">预算 ¥{{ formatMoney(row.budget) }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="退款政策" width="92" align="center">
          <template #default="{ row }">
            <ElTag :type="refundPolicyTag(row.refund_policy)" size="small" effect="plain">
              {{ refundPolicyShort(row.refund_policy) }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="92" align="center">
          <template #default="{ row }">
            <ElTag :type="orderStatusTag(row.status)" size="small" effect="light">
              {{ orderStatusLabel(row.status) }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="支付" width="92" align="center">
          <template #default="{ row }">
            <ElTag
              v-if="row.pay_status"
              :type="payStatusTag(row.pay_status)"
              size="small"
              effect="plain"
            >
              {{ row.pay_status_text || payStatusLabel(row.pay_status) }}
            </ElTag>
            <span v-else class="sub-text">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="下单时间" width="160">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openDetail(row as Order)">详情</ElButton>
            <ElButton
              v-if="row.status === 'pending' || row.status === 'dispatched'"
              link
              type="warning"
              size="small"
              @click="openDispatch(row as Order)"
            >
              {{ row.status === 'dispatched' ? '改派' : '派单' }}
            </ElButton>
            <ElDropdown
              style="margin-left: 8px"
              @command="(cmd: string) => handleRowCommand(cmd, row as Order)"
            >
              <ElButton link type="primary" size="small">
                操作<ElIcon><ArrowDown /></ElIcon>
              </ElButton>
              <template #dropdown>
                <ElDropdownMenu>
                  <ElDropdownItem v-if="row.status === 'accepted'" command="start">开始服务</ElDropdownItem>
                  <ElDropdownItem v-if="row.status === 'working'" command="finish">确认完工</ElDropdownItem>
                  <ElDropdownItem v-if="row.status === 'finished'" command="confirm">确认完成</ElDropdownItem>
                  <ElDropdownItem v-if="row.status === 'aborted'" command="confirm">确认结算</ElDropdownItem>
                  <ElDropdownItem
                    v-if="['pending', 'dispatched', 'accepted'].includes(row.status)"
                    command="cancel"
                  >
                    取消订单
                  </ElDropdownItem>
                  <ElDropdownItem
                    v-if="!['pending', 'dispatched', 'accepted', 'working', 'finished', 'aborted'].includes(row.status)"
                    disabled
                  >
                    无可执行操作
                  </ElDropdownItem>
                </ElDropdownMenu>
              </template>
            </ElDropdown>
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

    <!-- 新建订单弹窗 -->
    <ElDialog v-model="createVisible" title="代客新建订单" width="560px" destroy-on-close>
      <ElForm ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <ElFormItem label="客户" prop="customer_id">
          <ElSelect
            v-model="createForm.customer_id"
            filterable
            remote
            clearable
            placeholder="选择客户（可输入手机号搜索）"
            :remote-method="searchCustomers"
            :loading="customerLoading"
            style="width: 100%"
          >
            <ElOption
              v-for="c in customerOptions"
              :key="c.id"
              :label="`${c.name || '未填写'}（${c.phone}）`"
              :value="c.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="客户手机" prop="customer_phone">
          <ElInput v-model="createForm.customer_phone" placeholder="或直接填客户手机号（需已注册）" maxlength="11" />
        </ElFormItem>
        <ElFormItem label="服务类目" prop="category_id">
          <ElSelect v-model="createForm.category_id" placeholder="选择类目" style="width: 100%">
            <ElOption v-for="c in onSaleCategories" :key="c.id" :label="`${c.icon} ${c.name}`" :value="c.id" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="标题" prop="title">
          <ElInput v-model="createForm.title" placeholder="如：油烟机清洗" maxlength="100" />
        </ElFormItem>
        <ElFormItem label="描述">
          <ElInput v-model="createForm.description" type="textarea" :rows="2" placeholder="需求描述（选填）" />
        </ElFormItem>
        <ElFormItem label="地址" prop="address">
          <div style="width: 100%">
            <div class="address-row">
              <ElInput v-model="createForm.address" placeholder="上门地址" maxlength="255" />
              <ElButton :icon="Location" @click="pickerVisible = true">地图选点</ElButton>
            </div>
            <div v-if="createForm.lng != null && createForm.lat != null" class="coord-text">
              经度 {{ createForm.lng }} / 纬度 {{ createForm.lat }}
            </div>
          </div>
        </ElFormItem>
        <ElFormItem label="期望时间">
          <ElDatePicker
            v-model="createForm.expect_at"
            type="datetime"
            placeholder="期望上门时间（选填）"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="width: 100%"
          />
        </ElFormItem>
        <ElFormItem label="退款政策" prop="refund_policy">
          <ElRadioGroup v-model="createForm.refund_policy">
            <ElRadioButton value="flexible">支持中途退款</ElRadioButton>
            <ElRadioButton value="strict">不可中途退款</ElRadioButton>
          </ElRadioGroup>
          <div class="form-tip">开工前均可全额退；开工后按所选政策执行（下单后不可修改）</div>
        </ElFormItem>
        <ElFormItem label="计费方式" prop="billing_type">
          <ElRadioGroup v-model="createForm.billing_type">
            <ElRadioButton value="fixed">一口价</ElRadioButton>
            <ElRadioButton value="hourly">时薪</ElRadioButton>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem v-if="createForm.billing_type === 'hourly'" label="时薪" prop="hourly_price">
          <div style="width: 100%">
            <div class="address-row">
              <ElInputNumber
                v-model="createForm.hourly_price"
                :min="0"
                :max="99999"
                :precision="2"
                :step="10"
                style="width: 180px"
              />
              <span class="form-unit">元 / 小时</span>
            </div>
            <div class="form-tip">中途结束按半小时向上取整计费（40 分钟 = 1 小时 × 时薪）</div>
          </div>
        </ElFormItem>
        <ElFormItem label="预计费用" prop="budget">
          <ElInputNumber v-model="createForm.budget" :min="0" :precision="2" :step="10" style="width: 180px" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="createVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="creating" @click="submitCreate">创建订单</ElButton>
      </template>
    </ElDialog>

    <!-- 派单弹窗 -->
    <ElDialog v-model="dispatchVisible" :title="dispatchOrderRow?.status === 'dispatched' ? '改派师傅' : '派单'" width="640px" destroy-on-close>
      <div v-if="dispatchOrderRow" class="dispatch-order-line">
        <span class="sub-text">{{ dispatchOrderRow.order_no }}</span>
        <span>{{ dispatchOrderRow.category_icon || '🔧' }} {{ dispatchCategory.text }}</span>
        <ElTag v-if="dispatchCategory.custom" type="warning" size="small" effect="plain">自定义</ElTag>
        <span class="sub-text">{{ dispatchOrderRow.title }}</span>
      </div>
      <ElInput
        v-model="dispatchKeyword"
        placeholder="搜索师傅姓名/手机号"
        clearable
        :prefix-icon="Search"
        style="margin-bottom: 12px"
        @input="loadDispatchWorkers"
      />
      <ElRadioGroup v-model="dispatchWorkerId" class="worker-radio-group">
        <ElRadioButton
          v-for="w in dispatchWorkers"
          :key="w.id"
          :value="w.id"
          border
          class="worker-radio"
        >
          <div class="worker-item">
            <div class="worker-item-head">
              <span class="worker-name">{{ w.real_name || w.name || `师傅#${w.id}` }}</span>
              <ElIcon :size="13" color="#faad14"><Star /></ElIcon>
              <span>{{ w.rating ?? '5.0' }}</span>
              <span class="sub-text">{{ w.region || '未填写区域' }}</span>
            </div>
            <div class="worker-item-tags">
              <ElTag v-if="w.doing != null" size="small" type="warning" effect="plain">进行中 {{ w.doing }}</ElTag>
              <ElTag v-for="s in workerSkillText(w)" :key="s" size="small" type="info" effect="plain">{{ s }}</ElTag>
            </div>
          </div>
        </ElRadioButton>
      </ElRadioGroup>
      <ElEmpty v-if="!dispatchWorkers.length && !dispatchLoading" description="没有可派单的已认证师傅" :image-size="80" />
      <template #footer>
        <ElButton @click="dispatchVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="dispatching" :disabled="!dispatchWorkerId" @click="submitDispatch">
          确认派单
        </ElButton>
      </template>
    </ElDialog>

    <!-- 完工金额弹窗 -->
    <ElDialog v-model="finishVisible" title="填写完工金额" width="440px" destroy-on-close>
      <ElForm label-width="90px">
        <ElFormItem label="结算金额">
          <ElInputNumber v-model="finishForm.price" :min="0" :precision="2" :step="10" style="width: 180px" />
        </ElFormItem>
        <ElFormItem label="完工备注">
          <ElInput v-model="finishForm.remark" type="textarea" :rows="2" placeholder="选填" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="finishVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="handling" @click="submitFinish">提交完工</ElButton>
      </template>
    </ElDialog>

    <!-- 订单详情抽屉 -->
    <OrderDetailDrawer
      v-model:visible="detailVisible"
      :order-id="detailOrderId"
      @changed="load"
      @dispatch="(o) => { openDispatch(o); detailVisible = false }"
    />

    <!-- 地图选点（代客新建订单选址） -->
    <MapPicker
      v-model:visible="pickerVisible"
      :lng="createForm.lng"
      :lat="createForm.lat"
      :address="createForm.address"
      @confirm="onMapConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ArrowDown, Location, Plus, Search, Star } from '@element-plus/icons-vue'
import {
  ElButton,
  ElDialog,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElOption,
  ElPagination,
  ElRadioGroup,
  ElRadioButton,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
  ElDatePicker,
  ElMessageBox,
  ElMessage,
  type FormInstance,
  type FormRules,
} from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { fetchCategories } from '@/api/modules/category'
import { fetchCustomers } from '@/api/modules/customer'
import { createOrder, dispatchOrder, fetchOrders, handleOrder } from '@/api/modules/order'
import { fetchWorkers } from '@/api/modules/worker'
import type { Category, Customer, Order, Worker } from '@/api/types'
import MapPicker from '@/components/MapPicker.vue'
import { ORDER_STATUS_OPTIONS } from '@/constants/order.constants'
import {
  categoryLabel,
  formatMoney,
  formatTime,
  maskPhone,
  orderStatusLabel,
  orderStatusTag,
  payStatusLabel,
  payStatusTag,
  refundPolicyShort,
  refundPolicyTag,
} from '@/utils/format'
import OrderDetailDrawer from './OrderDetailDrawer.vue'

const route = useRoute()

// ---------- 列表 ----------
const loading = ref(false)
const list = ref<Order[]>([])
const total = ref(0)
const query = reactive({
  status: '',
  keyword: '',
  page: 1,
  page_size: 10,
})

async function load() {
  loading.value = true
  try {
    const res = await fetchOrders({
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

// ---------- 详情抽屉 ----------
const detailVisible = ref(false)
const detailOrderId = ref(0)

function openDetail(row: Order) {
  detailOrderId.value = row.id
  detailVisible.value = true
}

// ---------- 类目（新建订单下拉用） ----------
const categories = ref<Category[]>([])
const onSaleCategories = computed(() => categories.value.filter((c) => c.status === 1))

async function loadCategories() {
  const res = await fetchCategories()
  categories.value = res.list ?? []
}

// ---------- 新建订单 ----------
const createVisible = ref(false)
const creating = ref(false)
const createFormRef = ref<FormInstance>()
const customerOptions = ref<Customer[]>([])
const customerLoading = ref(false)

const createForm = reactive({
  customer_id: undefined as number | undefined,
  customer_phone: '',
  category_id: undefined as number | undefined,
  title: '',
  description: '',
  address: '',
  /** 地图选点坐标（未选为 null） */
  lng: null as number | null,
  lat: null as number | null,
  expect_at: '',
  budget: undefined as number | undefined,
  /** 退款政策（下单锁定，默认支持中途退款） */
  refund_policy: 'flexible' as 'flexible' | 'strict',
  /** 计费方式（默认一口价） */
  billing_type: 'fixed' as 'fixed' | 'hourly',
  /** 时薪（billing_type=hourly 时必填 >0） */
  hourly_price: undefined as number | undefined,
})

const createRules: FormRules = {
  category_id: [{ required: true, message: '请选择服务类目', trigger: 'change' }],
  title: [{ required: true, message: '请输入订单标题', trigger: 'blur' }],
  address: [{ required: true, message: '请输入上门地址', trigger: 'blur' }],
  budget: [{ required: true, message: '请输入预计费用', trigger: 'blur' }],
  // 时薪单必须填写大于 0 的时薪
  hourly_price: [
    {
      validator: (_rule, value, callback) => {
        if (createForm.billing_type === 'hourly' && !(Number(value) > 0)) {
          callback(new Error('时薪需大于 0'))
          return
        }
        callback()
      },
      trigger: 'change',
    },
  ],
}

function openCreate() {
  createForm.customer_id = undefined
  createForm.customer_phone = ''
  createForm.category_id = undefined
  createForm.title = ''
  createForm.description = ''
  createForm.address = ''
  createForm.lng = null
  createForm.lat = null
  createForm.expect_at = ''
  createForm.budget = undefined
  createForm.refund_policy = 'flexible'
  createForm.billing_type = 'fixed'
  createForm.hourly_price = undefined
  customerOptions.value = []
  createVisible.value = true
}

/** 是否时薪单（金额列展示 ¥X/h） */
function isHourlyOrder(row: Order) {
  return row.billing_type === 'hourly' && Number(row.hourly_price) > 0
}

// ---------- 地图选点 ----------
const pickerVisible = ref(false)

/** 选点确认：回填地址与坐标 */
function onMapConfirm(payload: { lng: number; lat: number; address: string }) {
  createForm.lng = payload.lng
  createForm.lat = payload.lat
  if (payload.address) {
    createForm.address = payload.address
  }
}

/** 远程搜索客户 */
async function searchCustomers(keyword: string) {
  if (!keyword) {
    customerOptions.value = []
    return
  }
  customerLoading.value = true
  try {
    const res = await fetchCustomers({ keyword, page: 1, page_size: 20 })
    customerOptions.value = res.list ?? []
  } finally {
    customerLoading.value = false
  }
}

/** 通过手机号解析客户 id */
async function resolveCustomerIdByPhone(phone: string): Promise<number | null> {
  const res = await fetchCustomers({ keyword: phone, page: 1, page_size: 20 })
  const hit = (res.list ?? []).find((c) => c.phone === phone)
  return hit ? hit.id : null
}

async function submitCreate() {
  if (!createFormRef.value) return
  await createFormRef.value.validate(async (valid) => {
    if (!valid) return
    let customerId = createForm.customer_id
    if (!customerId && createForm.customer_phone) {
      customerId = (await resolveCustomerIdByPhone(createForm.customer_phone)) ?? undefined
      if (!customerId) {
        ElMessage.error('未找到该手机号对应的客户，请先在客户管理确认')
        return
      }
    }
    if (!customerId) {
      ElMessage.warning('请选择客户或填写客户手机号')
      return
    }
    creating.value = true
    try {
      await createOrder({
        customer_id: customerId,
        category_id: createForm.category_id!,
        title: createForm.title,
        description: createForm.description || undefined,
        address: createForm.address,
        lng: createForm.lng ?? undefined,
        lat: createForm.lat ?? undefined,
        expect_at: createForm.expect_at || undefined,
        budget: createForm.budget ?? 0,
        // 阶段二：退款政策 / 计费方式（下单后锁定不可改）
        refund_policy: createForm.refund_policy,
        billing_type: createForm.billing_type,
        hourly_price: createForm.billing_type === 'hourly' ? (createForm.hourly_price ?? 0) : undefined,
      })
      ElMessage.success('订单创建成功')
      createVisible.value = false
      search()
    } finally {
      creating.value = false
    }
  })
}

// ---------- 派单 ----------
const dispatchVisible = ref(false)
const dispatching = ref(false)
const dispatchLoading = ref(false)
const dispatchKeyword = ref('')
const dispatchWorkers = ref<Worker[]>([])
const dispatchWorkerId = ref<number>()
const dispatchOrderRow = ref<Order>()
/** 派单弹窗顶部展示的订单类目（兼容自定义类型） */
const dispatchCategory = computed(() => categoryLabel(dispatchOrderRow.value))

/** 技能标签展示（优先后端给的类目名，其次用类目表映射 id） */
function workerSkillText(w: Worker): string[] {
  if (Array.isArray(w.skill_names) && w.skill_names.length) return w.skill_names
  if (!w.skills) return []
  return String(w.skills)
    .split(',')
    .map((id) => categories.value.find((c) => c.id === Number(id))?.name)
    .filter((n): n is string => !!n)
}

async function loadDispatchWorkers() {
  dispatchLoading.value = true
  try {
    const res = await fetchWorkers({
      status: 'approved',
      keyword: dispatchKeyword.value || undefined,
      page: 1,
      page_size: 100,
    })
    dispatchWorkers.value = res.list ?? []
  } finally {
    dispatchLoading.value = false
  }
}

function openDispatch(row: Order) {
  dispatchOrderRow.value = row
  dispatchKeyword.value = ''
  dispatchWorkerId.value = undefined
  dispatchVisible.value = true
  loadDispatchWorkers()
}

async function submitDispatch() {
  const row = dispatchOrderRow.value
  if (!row || !dispatchWorkerId.value) return
  dispatching.value = true
  try {
    await dispatchOrder(row.id, dispatchWorkerId.value)
    ElMessage.success(row.status === 'dispatched' ? '改派成功' : '派单成功')
    dispatchVisible.value = false
    load()
    if (detailVisible.value && detailOrderId.value === row.id) {
      // 抽屉开着时同步刷新详情
      detailVisible.value = false
    }
  } finally {
    dispatching.value = false
  }
}

// ---------- 代操作（开始/完工/确认/取消） ----------
const finishVisible = ref(false)
const handling = ref(false)
const finishForm = reactive({
  orderId: 0,
  price: undefined as number | undefined,
  remark: '',
})

/** 行内操作下拉 */
async function handleRowCommand(cmd: string, row: Order) {
  if (cmd === 'start') {
    await doHandling(row.id, { action: 'start' }, '已开始服务')
  } else if (cmd === 'finish') {
    finishForm.orderId = row.id
    finishForm.price = Number(row.price) > 0 ? Number(row.price) : Number(row.budget)
    finishForm.remark = ''
    finishVisible.value = true
  } else if (cmd === 'confirm') {
    const successText = row.status === 'aborted' ? '已确认结算，师傅钱包入账' : '已确认完成，师傅钱包入账'
    await doHandling(row.id, { action: 'confirm' }, successText)
  } else if (cmd === 'cancel') {
    try {
      const { value } = await ElMessageBox.prompt('请输入取消原因', '取消订单', {
        confirmButtonText: '确认取消',
        cancelButtonText: '再想想',
        inputValidator: (v: string) => (!!v && !!v.trim()) || '取消原因不能为空',
      })
      await doHandling(row.id, { action: 'cancel', reason: value }, '订单已取消')
    } catch {
      // 用户放弃
    }
  }
}

async function submitFinish() {
  if (!finishForm.price && finishForm.price !== 0) {
    ElMessage.warning('请填写结算金额')
    return
  }
  handling.value = true
  try {
    await handleOrder(finishForm.orderId, {
      action: 'finish',
      price: finishForm.price,
      remark: finishForm.remark || undefined,
    })
    ElMessage.success('完工信息已提交，订单进入待确认')
    finishVisible.value = false
    load()
  } finally {
    handling.value = false
  }
}

/** 通用代操作 */
async function doHandling(orderId: number, payload: { action: 'start' | 'confirm' | 'cancel'; reason?: string }, successText: string) {
  try {
    await handleOrder(orderId, payload)
    ElMessage.success(successText)
    load()
  } catch {
    // 错误已由 http 拦截器提示
  }
}

// ---------- 初始化 ----------
onMounted(async () => {
  // 支持从概览/客户页带 keyword 跳转
  const kw = route.query.keyword
  if (typeof kw === 'string' && kw) {
    query.keyword = kw
  }
  loadCategories()
  load()
})
</script>

<style scoped>
.sub-text {
  color: #909399;
  font-size: 12px;
}

/* 类目列：文案 + 自定义标签 */
.cat-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 地址行：输入框 + 地图选点按钮 */
.address-row {
  display: flex;
  gap: 8px;
}

.address-row .el-input {
  flex: 1;
}

/* 已选坐标小字 */
.coord-text {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

/* 表单项提示小字（退款政策/时薪说明） */
.form-tip {
  width: 100%;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

/* 时薪单位 */
.form-unit {
  margin-left: 8px;
  font-size: 13px;
  color: #606266;
}

/* 派单弹窗顶部：订单摘要 */
.dispatch-order-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #303133;
}

.worker-radio-group {
  display: block;
}

.worker-radio {
  display: block;
  width: 100%;
  margin-bottom: 8px;
  height: auto !important;
  padding: 8px 12px !important;
}

.worker-radio :deep(.el-radio-button__inner) {
  display: block;
  width: 100%;
  text-align: left;
  white-space: normal;
}

.worker-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.worker-name {
  font-weight: 600;
}

.worker-item-tags {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
