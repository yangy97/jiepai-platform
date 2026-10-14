import { get, post } from '../http'
import type { Notification, PageQuery, Paginated } from '../types'

/** 站内通知列表查询参数（GET /api/notifications） */
export interface NotificationQuery extends PageQuery {
  /** 1 = 只看未读 */
  unread?: 0 | 1
}

/** 通知列表响应（在分页结构上多返回未读数） */
export interface NotificationList extends Paginated<Notification> {
  unread_count: number
}

/** 拉取当前登录用户（运营）的站内通知 */
export function fetchNotifications(params?: NotificationQuery) {
  return get<NotificationList>('/api/notifications', { params })
}

/** 标记已读：ids 缺省 = 全部已读 */
export function readNotifications(ids?: number[]) {
  return post<{ unread_count: number }>('/api/notifications/read', ids && ids.length ? { ids } : {})
}
