import { del, get, post, put } from '../http'
import type { Category } from '../types'

/** 类目新增/编辑入参 */
export interface CategoryPayload {
  name: string
  icon: string
  min_price: number
  unit: string
  description?: string
  sort: number
  status: number
}

/** 全量类目（含下架） */
export function fetchCategories() {
  return get<{ list: Category[] }>('/api/admin/categories')
}

/** 新建类目 */
export function createCategory(payload: CategoryPayload) {
  return post<{ category: Category }>('/api/admin/categories', payload)
}

/** 编辑类目 */
export function updateCategory(id: number, payload: CategoryPayload) {
  return put<{ category: Category }>(`/api/admin/categories/${id}`, payload)
}

/** 删除类目（有关联订单时后端返回 409） */
export function deleteCategory(id: number) {
  return del<null>(`/api/admin/categories/${id}`)
}
