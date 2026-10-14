/**
 * service_categories 表模型（无 updated_at 列 → timestamps 仅管理 created_at）
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';

export interface ServiceCategoryAttributes {
  id: number;
  name: string;
  /** 展示图标（emoji） */
  icon: string;
  /** 起步价 DECIMAL(10,2) */
  min_price: string | number;
  /** 计价单位，如 次/件/起 */
  unit: string;
  description: string;
  /** 排序，越大越靠前 */
  sort: number;
  /** 1 上架 0 下架 */
  status: number;
  created_at: string;
}

export type ServiceCategoryCreationAttributes = Optional<
  ServiceCategoryAttributes,
  'id' | 'icon' | 'min_price' | 'unit' | 'description' | 'sort' | 'status' | 'created_at'
>;

export class ServiceCategory
  extends Model<ServiceCategoryAttributes, ServiceCategoryCreationAttributes>
  implements ServiceCategoryAttributes
{
  declare id: number;
  declare name: string;
  declare icon: string;
  declare min_price: string | number;
  declare unit: string;
  declare description: string;
  declare sort: number;
  declare status: number;
  declare created_at: string;
}

/** 由 src/db/models/index.ts 调用 */
export function initServiceCategoryModel(sequelize: Sequelize): void {
  ServiceCategory.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(50), allowNull: false },
      icon: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '🔧' },
      min_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      unit: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '起' },
      description: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      sort: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
      created_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'service_categories',
      freezeTableName: true,
      // 表内无 updated_at：只管理 created_at（与 mysql2 时代一致，INSERT 交给 DB 默认值亦可）
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [{ fields: ['sort'] }],
    },
  );
}
