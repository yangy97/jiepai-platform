/**
 * wallets 表模型（注意：该表只有 updated_at，没有 created_at）
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';

export interface WalletAttributes {
  id: number;
  user_id: number;
  /** 可用余额 DECIMAL(10,2) */
  balance: string | number;
  /** 累计收入 DECIMAL(10,2) */
  income: string | number;
  /** 累计提现 DECIMAL(10,2) */
  withdrawn: string | number;
  updated_at: string;
}

export type WalletCreationAttributes = Optional<WalletAttributes, 'id' | 'balance' | 'income' | 'withdrawn' | 'updated_at'>;

export class Wallet extends Model<WalletAttributes, WalletCreationAttributes> implements WalletAttributes {
  declare id: number;
  declare user_id: number;
  declare balance: string | number;
  declare income: string | number;
  declare withdrawn: string | number;
  declare updated_at: string;
}

/** 由 src/db/models/index.ts 调用 */
export function initWalletModel(sequelize: Sequelize): void {
  Wallet.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: 'uk_user' },
      balance: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      income: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      withdrawn: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'wallets',
      freezeTableName: true,
      // 表内无 created_at：只管理 updated_at
      timestamps: true,
      createdAt: false,
      updatedAt: 'updated_at',
      indexes: [{ unique: true, fields: ['user_id'] }],
    },
  );
}
