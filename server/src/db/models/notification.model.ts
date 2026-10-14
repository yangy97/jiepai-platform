/**
 * notifications 表模型（站内通知，无 updated_at 列）
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';

export interface NotificationAttributes {
  id: number;
  /** 接收人 users.id */
  user_id: number;
  /** 关联订单（可空） */
  order_id: number | null;
  /** dispatch/accept/start_remind/start_timeout/finish/confirm/refund/rate/restrict/abort */
  type: string;
  title: string;
  content: string;
  /** 0 未读 1 已读 */
  is_read: number;
  created_at: string;
}

export type NotificationCreationAttributes = Optional<
  NotificationAttributes,
  'id' | 'order_id' | 'is_read' | 'created_at'
>;

export class Notification
  extends Model<NotificationAttributes, NotificationCreationAttributes>
  implements NotificationAttributes
{
  declare id: number;
  declare user_id: number;
  declare order_id: number | null;
  declare type: string;
  declare title: string;
  declare content: string;
  declare is_read: number;
  declare created_at: string;
}

/** 由 src/db/models/index.ts 调用 */
export function initNotificationModel(sequelize: Sequelize): void {
  Notification.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      type: { type: DataTypes.STRING(32), allowNull: false },
      title: { type: DataTypes.STRING(100), allowNull: false },
      content: { type: DataTypes.STRING(255), allowNull: false },
      is_read: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'notifications',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [{ fields: ['user_id', 'is_read', 'created_at'] }],
    },
  );
}
