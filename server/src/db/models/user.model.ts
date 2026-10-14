/**
 * users 表模型（列与 src/db/schema.sql / 库内 DDL 严格对齐，只读映射，绝不 sync/alter）
 * - DECIMAL(2,1)（rating）：mysql2 默认返回字符串，类型放宽为 string | number
 * - DATETIME：连接层 dateStrings:true，读回 'YYYY-MM-DD HH:mm:ss' 字符串
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';
import type { UserRole } from '../../types';

export interface UserAttributes {
  id: number;
  phone: string;
  /** bcrypt 密码（仅服务端校验使用，不对外） */
  password: string;
  name: string;
  avatar: string;
  role: UserRole;
  /** 1 正常 0 停用 */
  status: number;
  openid: string;
  /** 客户被评均分（师傅→客户）DECIMAL(2,1) */
  rating: string | number;
  /** 1 受限（近 N 单均分过低，禁止下单） */
  restricted: number;
  restricted_reason: string;
  restricted_until: string | null;
  created_at: string;
  updated_at: string;
}

export type UserCreationAttributes = Optional<
  UserAttributes,
  'id' | 'status' | 'name' | 'avatar' | 'openid' | 'rating' | 'restricted' | 'restricted_reason' | 'restricted_until' | 'created_at' | 'updated_at'
>;

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: number;
  declare phone: string;
  declare password: string;
  declare name: string;
  declare avatar: string;
  declare role: UserRole;
  declare status: number;
  declare openid: string;
  declare rating: string | number;
  declare restricted: number;
  declare restricted_reason: string;
  declare restricted_until: string | null;
  declare created_at: string;
  declare updated_at: string;
}

/** 由 src/db/models/index.ts 在创建 sequelize 实例后调用（避免模型文件与实例所在桶文件循环引用） */
export function initUserModel(sequelize: Sequelize): void {
  User.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      phone: { type: DataTypes.STRING(20), allowNull: false, unique: 'uk_phone' },
      password: { type: DataTypes.STRING(100), allowNull: false },
      name: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },
      avatar: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      role: { type: DataTypes.ENUM('admin', 'customer', 'worker'), allowNull: false, defaultValue: 'customer' },
      status: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
      openid: { type: DataTypes.STRING(64), allowNull: false, defaultValue: '' },
      rating: { type: DataTypes.DECIMAL(2, 1), allowNull: false, defaultValue: 5.0 },
      restricted: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      restricted_reason: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      restricted_until: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'users',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { unique: true, fields: ['phone'] },
        { fields: ['role'] },
      ],
    },
  );
}
