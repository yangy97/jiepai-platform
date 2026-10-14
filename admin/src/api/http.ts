import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'

/** token 存储 key */
export const TOKEN_KEY = 'jp_token'

/** 统一响应体（见 docs/API.md） */
interface ApiResult<T = unknown> {
  code: number
  message: string
  data: T
}

/** axios 实例：dev 下同源，/api 由 vite proxy 转发到后端 7010 */
const instance = axios.create({
  baseURL: '',
  timeout: 20000,
})

/** 清除登录态并跳转登录页 */
function redirectToLogin() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem('jp_user')
  const current = router.currentRoute.value
  if (current.path !== '/login') {
    router.replace({ path: '/login', query: { redirect: current.fullPath } })
  }
}

// 请求拦截器：附带 JWT
instance.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：code===0 直接返回 data，否则 toast 错误信息；401 踢回登录页
instance.interceptors.response.use(
  (response) => {
    const res = response.data as ApiResult
    if (res && typeof res.code === 'number') {
      if (res.code === 0) {
        return res.data
      }
      if (res.code === 401) {
        redirectToLogin()
      }
      ElMessage.error(res.message || '请求失败')
      return Promise.reject(new Error(res.message || '请求失败'))
    }
    // 非统一响应体，原样返回
    return response.data
  },
  (error: AxiosError<ApiResult>) => {
    const status = error.response?.status
    const msg = error.response?.data?.message || error.message || '网络异常，请稍后重试'
    if (status === 401) {
      redirectToLogin()
    } else if (status === 403) {
      ElMessage.error(msg || '无权限访问')
    } else {
      ElMessage.error(msg)
    }
    return Promise.reject(error)
  },
)

/** GET，返回 data 部分 */
export function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return instance.get(url, config) as unknown as Promise<T>
}

/** POST，返回 data 部分 */
export function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return instance.post(url, data, config) as unknown as Promise<T>
}

/** PUT，返回 data 部分 */
export function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return instance.put(url, data, config) as unknown as Promise<T>
}

/** PATCH，返回 data 部分 */
export function patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return instance.patch(url, data, config) as unknown as Promise<T>
}

/** DELETE，返回 data 部分 */
export function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return instance.delete(url, config) as unknown as Promise<T>
}
