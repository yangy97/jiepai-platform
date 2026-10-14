import { get, patch, post } from '../http'
import type { PageQuery, Paginated, Worker, WorkerDetail } from '../types'

/** 师傅列表查询参数 */
export interface WorkerQuery extends PageQuery {
  status?: string
  keyword?: string
}

/** 师傅分页列表 */
export function fetchWorkers(params: WorkerQuery) {
  return get<Paginated<Worker>>('/api/admin/workers', { params })
}

/** 师傅详情 */
export function fetchWorkerDetail(id: number) {
  return get<WorkerDetail>(`/api/admin/workers/${id}`)
}

/** 认证审核 */
export function auditWorker(id: number, status: 'approved' | 'rejected', remark?: string) {
  return post<{ worker: Worker }>(`/api/admin/workers/${id}/audit`, { status, remark })
}

/** 停用 / 启用 */
export function updateWorkerStatus(id: number, status: 'disabled' | 'enabled') {
  return patch<{ worker: Worker }>(`/api/admin/workers/${id}`, { status })
}

/** 解除接单限制（恢复 restricted=0，低分限制可手动提前解除） */
export function unrestrictWorker(id: number) {
  return post<{ worker: Worker }>(`/api/admin/workers/${id}/unrestrict`)
}
