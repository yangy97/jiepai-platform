import type { WalletLog } from '@/api/types'

/** 钱包流水类型 → 文案/颜色 */
export const WALLET_TYPE_META: Record<WalletLog['type'], { label: string; tag: 'success' | 'danger' | 'warning' | 'info' }> = {
  income: { label: '收入', tag: 'success' },
  withdraw: { label: '提现', tag: 'warning' },
  refund: { label: '退款', tag: 'info' },
}
