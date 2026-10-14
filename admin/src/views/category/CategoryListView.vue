<template>
  <div class="page">
    <!-- 提示：类目与小程序实时同步 -->
    <ElAlert type="info" :closable="false" show-icon style="margin-bottom: 12px">
      <template #title>
        此处新增/上架的服务类型会<b>实时同步到小程序</b>首页与下单页；小程序端用户也可选择『自定义』类型下单，未建类目的订单会在订单管理里标注『自定义』。
      </template>
    </ElAlert>

    <div class="table-title">
      <span>服务类目</span>
      <ElButton type="primary" :icon="Plus" @click="openCreate">新建类目</ElButton>
    </div>

    <!-- 类目表格：撑满剩余高度，表体在可视区内滚动 -->
    <div class="table-wrap">
      <ElTable v-loading="loading" :data="list" empty-text="暂无类目" style="width: 100%">
        <ElTableColumn label="图标" width="80" align="center">
          <template #default="{ row }">
            <span class="category-icon">{{ row.icon || '🔧' }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="name" label="名称" min-width="120" />
        <ElTableColumn label="起步价" width="110" align="right">
          <template #default="{ row }">¥{{ formatMoney(row.min_price) }}</template>
        </ElTableColumn>
        <ElTableColumn prop="unit" label="计价单位" width="100" align="center">
          <template #default="{ row }">{{ row.unit || '起' }}</template>
        </ElTableColumn>
        <ElTableColumn prop="sort" label="排序" width="80" align="center" />
        <ElTableColumn label="状态" width="100" align="center">
          <template #default="{ row }">
            <ElSwitch
              :model-value="row.status === 1"
              active-text="上架"
              inactive-text="下架"
              inline-prompt
              :loading="statusLoadingId === row.id"
              @change="(v: boolean | string | number) => toggleStatus(row as Category, v === true)"
            />
          </template>
        </ElTableColumn>
        <ElTableColumn prop="description" label="备注" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.description || '—' }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openEdit(row as Category)">编辑</ElButton>
            <ElButton link type="danger" size="small" @click="removeRow(row as Category)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <!-- 新建/编辑弹窗 -->
    <ElDialog v-model="formVisible" :title="form.id ? '编辑类目' : '新建类目'" width="520px" destroy-on-close>
      <ElForm ref="formRef" :model="form" :rules="rules" label-width="90px">
        <ElFormItem label="名称" prop="name">
          <ElInput v-model="form.name" placeholder="如：家电清洗" maxlength="50" />
        </ElFormItem>
        <ElFormItem label="图标" prop="icon">
          <div style="width: 100%">
            <div class="emoji-picker">
              <span
                v-for="e in EMOJIS"
                :key="e"
                class="emoji-item"
                :class="{ active: form.icon === e }"
                @click="form.icon = e"
              >
                {{ e }}
              </span>
            </div>
            <ElInput v-model="form.icon" placeholder="emoji 图标" maxlength="8" style="margin-top: 8px; width: 160px" />
          </div>
        </ElFormItem>
        <ElFormItem label="起步价" prop="min_price">
          <ElInputNumber v-model="form.min_price" :min="0" :precision="2" :step="10" style="width: 180px" />
        </ElFormItem>
        <ElFormItem label="计价单位" prop="unit">
          <ElInput v-model="form.unit" placeholder="如：次 / 件 / 起" maxlength="20" style="width: 180px" />
        </ElFormItem>
        <ElFormItem label="备注说明">
          <ElInput
            v-model="form.description"
            type="textarea"
            :rows="2"
            placeholder="备注说明（选填）：服务范围、注意事项等"
            maxlength="255"
          />
        </ElFormItem>
        <ElFormItem label="排序" prop="sort">
          <ElInputNumber v-model="form.sort" :min="0" :step="1" style="width: 180px" />
        </ElFormItem>
        <ElFormItem label="状态">
          <ElRadioGroup v-model="form.status">
            <ElRadioButton :value="1">上架</ElRadioButton>
            <ElRadioButton :value="0">下架</ElRadioButton>
          </ElRadioGroup>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="formVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="submit">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
import { Plus } from '@element-plus/icons-vue'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessageBox,
  ElMessage,
  ElRadioButton,
  ElRadioGroup,
  ElSwitch,
  ElTable,
  ElTableColumn,
  type FormInstance,
  type FormRules,
} from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { createCategory, deleteCategory, fetchCategories, updateCategory } from '@/api/modules/category'
import type { Category } from '@/api/types'
import { formatMoney } from '@/utils/format'

/** 快捷 emoji 列表 */
const EMOJIS = ['🧹', '🔧', '🪟', '🛠️', '🚿', '🧽', '❄️', '🔌', '🪛', '🚪', '🛋️', '🐛']

const loading = ref(false)
const list = ref<Category[]>([])

async function load() {
  loading.value = true
  try {
    const res = await fetchCategories()
    list.value = res.list ?? []
  } finally {
    loading.value = false
  }
}

// ---------- 状态开关 ----------
const statusLoadingId = ref(0)

async function toggleStatus(row: Category, on: boolean) {
  statusLoadingId.value = row.id
  try {
    await updateCategory(row.id, {
      name: row.name,
      icon: row.icon,
      min_price: Number(row.min_price),
      unit: row.unit,
      description: row.description,
      sort: row.sort,
      status: on ? 1 : 0,
    })
    ElMessage.success(on ? '已上架' : '已下架')
    load()
  } finally {
    statusLoadingId.value = 0
  }
}

// ---------- 新建 / 编辑 ----------
const formVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  id: 0,
  name: '',
  icon: '🔧',
  min_price: 0 as number,
  unit: '起',
  sort: 0,
  status: 1,
  description: '',
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入类目名称', trigger: 'blur' }],
  icon: [{ required: true, message: '请选择图标', trigger: 'change' }],
  unit: [{ required: true, message: '请输入计价单位', trigger: 'blur' }],
}

function resetForm() {
  form.id = 0
  form.name = ''
  form.icon = '🔧'
  form.min_price = 0
  form.unit = '起'
  form.sort = 0
  form.status = 1
  form.description = ''
}

function openCreate() {
  resetForm()
  formVisible.value = true
}

function openEdit(row: Category) {
  form.id = row.id
  form.name = row.name
  form.icon = row.icon
  form.min_price = Number(row.min_price)
  form.unit = row.unit
  form.sort = row.sort
  form.status = row.status
  form.description = row.description
  formVisible.value = true
}

async function submit() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      const payload = {
        name: form.name,
        icon: form.icon,
        min_price: form.min_price,
        unit: form.unit,
        description: form.description,
        sort: form.sort,
        status: form.status,
      }
      if (form.id) {
        await updateCategory(form.id, payload)
        ElMessage.success('类目已更新')
      } else {
        await createCategory(payload)
        ElMessage.success('类目已创建')
      }
      formVisible.value = false
      load()
    } finally {
      saving.value = false
    }
  })
}

// ---------- 删除 ----------
async function removeRow(row: Category) {
  try {
    await ElMessageBox.confirm(`确认删除类目「${row.name}」？`, '删除类目', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await deleteCategory(row.id)
    ElMessage.success('已删除')
    load()
  } catch {
    // 409（有关联订单）等错误已由 http 拦截器 toast message
  }
}

onMounted(load)
</script>

<style scoped>
.category-icon {
  font-size: 22px;
}

.emoji-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.emoji-item {
  width: 32px;
  height: 32px;
  line-height: 32px;
  text-align: center;
  font-size: 18px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}

.emoji-item:hover {
  background: #f5f7fa;
}

.emoji-item.active {
  border-color: #1890ff;
  background: #e6f7ff;
}
</style>
