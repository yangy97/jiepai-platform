<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">
        <span class="badge">接</span>
        <h2>接派 · 上门服务运营平台</h2>
        <p>Order Dispatch & Operations Console</p>
      </div>

      <ElForm ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="handleSubmit">
        <ElFormItem prop="phone">
          <ElInput v-model="form.phone" placeholder="手机号" :prefix-icon="Iphone" maxlength="11" />
        </ElFormItem>
        <ElFormItem prop="password">
          <ElInput
            v-model="form.password"
            type="password"
            placeholder="密码"
            :prefix-icon="Lock"
            show-password
          />
        </ElFormItem>
        <ElFormItem>
          <ElButton type="primary" class="login-btn" :loading="loading" @click="handleSubmit">
            登 录
          </ElButton>
        </ElFormItem>
      </ElForm>

      <div class="login-tip">
        <span>演示账号：13900000000 / admin123</span>
        <ElButton link type="primary" size="small" @click="fillDemo">一键填充</ElButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Lock, Iphone } from '@element-plus/icons-vue'
import { ElButton, ElForm, ElFormItem, ElInput, ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  phone: '',
  password: '',
})

const rules: FormRules = {
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1\d{10}$/, message: '手机号格式不正确', trigger: 'blur' },
  ],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

/** 一键填充演示账号 */
function fillDemo() {
  form.phone = '13900000000'
  form.password = 'admin123'
}

/** 登录 */
async function handleSubmit() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    try {
      await userStore.login(form.phone, form.password)
      // 仅允许运营角色进入管理端
      if (userStore.user?.role !== 'admin') {
        ElMessage.error('该账号无管理端权限')
        userStore.logout()
        return
      }
      ElMessage.success('登录成功')
      const redirect = (route.query.redirect as string) || '/dashboard'
      router.replace(redirect)
    } finally {
      loading.value = false
    }
  })
}
</script>

<style scoped>
.login-btn {
  width: 100%;
}
</style>
