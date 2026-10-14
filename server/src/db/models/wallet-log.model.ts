/**
 * wallet_logs 表模型（无 updated_at 列）
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';
import type { WalletLogType } from '../../types';

export interface WalletLogAttributes {
  id: number;
  user_id: number;
  order_id: number | null;
  type: WalletLogType;
  /** 正为入账 负为出账 DECIMAL(10,2) */
  amount: string | number;
  balance_after: string | number;
  remark: string;
  created_at: string;
}

export type WalletLogCreationAttributes = Optional<
  WalletLogAttributes,
  'id' | 'order_id' | 'balance_after' | 'remark' | 'created_at'
>;

export class WalletLog extends Model<WalletLogAttributes, WalletLogCreationAttributes> implements WalletLogAttributes {
  declare id: number;
  declare user_id: number;
  declare order_id: number | null;
  declare type: WalletLogType;
  declare amount: string | number;
  declare balance_after: string | number;
  declare remark: string;
  declare created_at: string;
}

/** 由 src/db/models/index.ts 调用 */
export function initWalletLogModel(sequelize: Sequelize): void {
  WalletLog.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      type: { type: DataTypes.ENUM('income', 'withdraw', 'refund'), allowNull: false, defaultValue: 'income' },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      balance_after: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      remark: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      created_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'wallet_logs',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [{ fields: ['user_id'] }],
    },
  );
}
