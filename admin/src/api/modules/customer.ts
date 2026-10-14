import { get, post } from '../http'
import type { Customer, PageQuery, Paginated } from '../types'

/** 客户列表查询参数 */
export interface CustomerQuery extends PageQuery {
  keyword?: string
}

/** 客户分页列表（含订单数、消费额） */
export function fetchCustomers(params: CustomerQuery) {
  return get<Paginated<Customer>>('/api/admin/customers', { params })
}

/** 解除下单限制（恢复 restricted=0，低分限制可手动提前解除） */
export function unrestrictCustomer(id: number) {
  return post<{ customer: Customer }>(`/api/admin/customers/${id}/unrestrict`)
}
