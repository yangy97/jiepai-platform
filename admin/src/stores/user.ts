import { defineStore } from 'pinia'
import { login as loginApi } from '@/api/modules/auth'
import { TOKEN_KEY } from '@/api/http'
import type { User } from '@/api/types'

interface UserState {
  token: string
  user: User | null
}

/** 登录态：token + 用户信息，持久化到 localStorage */
export const useUserStore = defineStore('user', {
  state: (): UserState => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: JSON.parse(localStorage.getItem('jp_user') || 'null') as User | null,
  }),
  actions: {
    /** 登录（手机号 + 密码） */
    async login(phone: string, password: string) {
      const { token, user } = await loginApi(phone, password)
      this.token = token
      this.user = user
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem('jp_user', JSON.stringify(user))
    },
    /** 退出登录，清理本地登录态 */
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('jp_user')
    },
  },
})
