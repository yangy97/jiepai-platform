/**
 * workers 表模型（列与库内 DDL 严格对齐，只读映射，绝不 sync/alter）
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';
import type { WorkerStatus } from '../../types';

export interface WorkerAttributes {
  id: number;
  user_id: number;
  real_name: string;
  id_card: string;
  region: string;
  /** 可接类目 id，逗号分隔 */
  skills: string;
  years: number;
  bio: string;
  /** 评分 DECIMAL(3,1) */
  rating: string | number;
  order_count: number;
  done_count: number;
  status: WorkerStatus;
  audit_remark: string;
  audited_at: string | null;
  restricted: number;
  restricted_reason: string;
  restricted_until: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkerCreationAttributes = Optional<
  WorkerAttributes,
  | 'id'
  | 'real_name'
  | 'id_card'
  | 'region'
  | 'skills'
  | 'years'
  | 'bio'
  | 'rating'
  | 'order_count'
  | 'done_count'
  | 'status'
  | 'audit_remark'
  | 'audited_at'
  | 'restricted'
  | 'restricted_reason'
  | 'restricted_until'
  | 'created_at'
  | 'updated_at'
>;

export class Worker extends Model<WorkerAttributes, WorkerCreationAttributes> implements WorkerAttributes {
  declare id: number;
  declare user_id: number;
  declare real_name: string;
  declare id_card: string;
  declare region: string;
  declare skills: string;
  declare years: number;
  declare bio: string;
  declare rating: string | number;
  declare order_count: number;
  declare done_count: number;
  declare status: WorkerStatus;
  declare audit_remark: string;
  declare audited_at: string | null;
  declare restricted: number;
  declare restricted_reason: string;
  declare restricted_until: string | null;
  declare created_at: string;
  declare updated_at: string;
}

/** 由 src/db/models/index.ts 调用 */
export function initWorkerModel(sequelize: Sequelize): void {
  Worker.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: 'uk_user' },
      real_name: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },
      id_card: { type: DataTypes.STRING(30), allowNull: false, defaultValue: '' },
      region: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
      skills: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      years: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      bio: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      rating: { type: DataTypes.DECIMAL(3, 1), allowNull: false, defaultValue: 5.0 },
      order_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      done_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disabled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      audit_remark: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      audited_at: { type: DataTypes.DATE, allowNull: true },
      restricted: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      restricted_reason: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      restricted_until: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'workers',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { unique: true, fields: ['user_id'] },
        { fields: ['status'] },
      ],
    },
  );
}
