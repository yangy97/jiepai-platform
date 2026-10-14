import { get, post } from '../http'
import type { LoginResult, User } from '../types'

/** 账号密码登录 */
export function login(phone: string, password: string) {
  return post<LoginResult>('/api/auth/login', { phone, password })
}

/** 当前登录用户 */
export function fetchMe() {
  return get<{ user: User }>('/api/auth/me')
}
