import { get } from '../http'
import type { PageQuery, Paginated, Wallet, WalletLog } from '../types'

/** 师傅钱包查询参数 */
export interface WalletQuery extends PageQuery {
  keyword?: string
}

/** 资金流水查询参数 */
export interface WalletLogQuery extends PageQuery {
  user_id?: number | string
  type?: string
}

/** 师傅钱包分页 */
export function fetchWallets(params: WalletQuery) {
  return get<Paginated<Wallet>>('/api/admin/wallets', { params })
}

/** 全平台资金流水分页 */
export function fetchWalletLogs(params: WalletLogQuery) {
  return get<Paginated<WalletLog>>('/api/admin/wallet-logs', { params })
}
