/**
 * order_logs 表模型（无 updated_at 列）
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';

export interface OrderLogAttributes {
  id: number;
  order_id: number;
  /** create/dispatch/accept/start/finish/confirm/cancel/rate/pay/refund */
  action: string;
  from_status: string;
  to_status: string;
  /** 操作人 users.id */
  operator_id: number | null;
  operator_role: string;
  content: string;
  created_at: string;
}

export type OrderLogCreationAttributes = Optional<
  OrderLogAttributes,
  'id' | 'from_status' | 'to_status' | 'operator_id' | 'operator_role' | 'content' | 'created_at'
>;

export class OrderLog extends Model<OrderLogAttributes, OrderLogCreationAttributes> implements OrderLogAttributes {
  declare id: number;
  declare order_id: number;
  declare action: string;
  declare from_status: string;
  declare to_status: string;
  declare operator_id: number | null;
  declare operator_role: string;
  declare content: string;
  declare created_at: string;
}

/** 由 src/db/models/index.ts 调用 */
export function initOrderLogModel(sequelize: Sequelize): void {
  OrderLog.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      action: { type: DataTypes.STRING(30), allowNull: false },
      from_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
      to_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
      operator_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      operator_role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
      content: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      created_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'order_logs',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [{ fields: ['order_id'] }],
    },
  );
}
