/** 师傅认证状态 → 文案/颜色 */
export const WORKER_STATUS_META: Record<string, { label: string; tag: 'primary' | 'success' | 'warning' | 'info' | 'danger' }> = {
  pending: { label: '待审核', tag: 'warning' },
  approved: { label: '已认证', tag: 'success' },
  rejected: { label: '已驳回', tag: 'danger' },
  disabled: { label: '已停用', tag: 'info' },
}
