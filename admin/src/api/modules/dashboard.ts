import { get } from '../http'
import type { DashboardData } from '../types'

/** 运营概览 */
export function fetchDashboard() {
  return get<DashboardData>('/api/admin/dashboard')
}
