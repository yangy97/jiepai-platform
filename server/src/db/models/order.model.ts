/**
 * orders 表模型（48 列与库内 DDL 严格对齐，只读映射，绝不 sync/alter）
 * - ENUM status/source 取值与库内一字不差
 * - DECIMAL(10,2)/(10,6)：mysql2 默认返回字符串，类型放宽为 string | number
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';
import type { OrderStatus } from '../../types';

export interface OrderAttributes {
  id: number;
  order_no: string;
  customer_id: number;
  worker_id: number | null;
  /** 服务类目；自定义类型订单为 NULL */
  category_id: number | null;
  custom_category: string;
  title: string;
  description: string | null;
  address: string;
  lng: string | number | null;
  lat: string | number | null;
  expect_at: string | null;
  budget: string | number;
  /** 实际结算金额（完工时填写） */
  price: string | number;
  /** 平台服务费 */
  service_fee: string | number;
  status: OrderStatus;
  source: 'customer' | 'admin';
  /** 支付状态 unpaid/paid/refunded */
  pay_status: string;
  paid_at: string | null;
  transaction_id: string;
  refund_id: string;
  refunded_at: string | null;
  refund_amount: string | number;
  refund_reason: string;
  /** flexible 支持中途退款 / strict 不可中途退款（下单锁定） */
  refund_policy: string;
  /** fixed 一口价 / hourly 时薪（下单锁定） */
  billing_type: string;
  hourly_price: string | number;
  abort_reason: string;
  aborted_at: string | null;
  /** 中途结算实收金额 */
  actual_fee: string | number;
  cancel_reason: string;
  finish_remark: string;
  /** 客户评价 1-5（总分） */
  rating: number | null;
  rate_comment: string;
  rate_skill: number | null;
  rate_attitude: number | null;
  rate_punctual: number | null;
  rate_tags: string;
  /** 客户配合度 1-5（师傅→客户评价） */
  worker_rating: number | null;
  worker_rate_comment: string;
  worker_rate_tags: string;
  dispatch_at: string | null;
  accepted_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type OrderCreationAttributes = Optional<
  OrderAttributes,
  | 'id'
  | 'worker_id'
  | 'category_id'
  | 'custom_category'
  | 'description'
  | 'address'
  | 'lng'
  | 'lat'
  | 'expect_at'
  | 'budget'
  | 'price'
  | 'service_fee'
  | 'status'
  | 'source'
  | 'pay_status'
  | 'paid_at'
  | 'transaction_id'
  | 'refund_id'
  | 'refunded_at'
  | 'refund_amount'
  | 'refund_reason'
  | 'refund_policy'
  | 'billing_type'
  | 'hourly_price'
  | 'abort_reason'
  | 'aborted_at'
  | 'actual_fee'
  | 'cancel_reason'
  | 'finish_remark'
  | 'rating'
  | 'rate_comment'
  | 'rate_skill'
  | 'rate_attitude'
  | 'rate_punctual'
  | 'rate_tags'
  | 'worker_rating'
  | 'worker_rate_comment'
  | 'worker_rate_tags'
  | 'dispatch_at'
  | 'accepted_at'
  | 'started_at'
  | 'finished_at'
  | 'completed_at'
  | 'cancelled_at'
  | 'created_at'
  | 'updated_at'
>;

export class Order extends Model<OrderAttributes, OrderCreationAttributes> implements OrderAttributes {
  declare id: number;
  declare order_no: string;
  declare customer_id: number;
  declare worker_id: number | null;
  declare category_id: number | null;
  declare custom_category: string;
  declare title: string;
  declare description: string | null;
  declare address: string;
  declare lng: string | number | null;
  declare lat: string | number | null;
  declare expect_at: string | null;
  declare budget: string | number;
  declare price: string | number;
  declare service_fee: string | number;
  declare status: OrderStatus;
  declare source: 'customer' | 'admin';
  declare pay_status: string;
  declare paid_at: string | null;
  declare transaction_id: string;
  declare refund_id: string;
  declare refunded_at: string | null;
  declare refund_amount: string | number;
  declare refund_reason: string;
  declare refund_policy: string;
  declare billing_type: string;
  declare hourly_price: string | number;
  declare abort_reason: string;
  declare aborted_at: string | null;
  declare actual_fee: string | number;
  declare cancel_reason: string;
  declare finish_remark: string;
  declare rating: number | null;
  declare rate_comment: string;
  declare rate_skill: number | null;
  declare rate_attitude: number | null;
  declare rate_punctual: number | null;
  declare rate_tags: string;
  declare worker_rating: number | null;
  declare worker_rate_comment: string;
  declare worker_rate_tags: string;
  declare dispatch_at: string | null;
  declare accepted_at: string | null;
  declare started_at: string | null;
  declare finished_at: string | null;
  declare completed_at: string | null;
  declare cancelled_at: string | null;
  declare created_at: string;
  declare updated_at: string;
}

/** 由 src/db/models/index.ts 调用 */
export function initOrderModel(sequelize: Sequelize): void {
  Order.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      order_no: { type: DataTypes.STRING(32), allowNull: false, unique: 'uk_no' },
      customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      worker_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      category_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      custom_category: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
      title: { type: DataTypes.STRING(100), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      address: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      lng: { type: DataTypes.DECIMAL(10, 6), allowNull: true },
      lat: { type: DataTypes.DECIMAL(10, 6), allowNull: true },
      expect_at: { type: DataTypes.DATE, allowNull: true },
      budget: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      service_fee: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      status: {
        type: DataTypes.ENUM('pending', 'dispatched', 'accepted', 'working', 'finished', 'aborted', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      source: { type: DataTypes.ENUM('customer', 'admin'), allowNull: false, defaultValue: 'customer' },
      pay_status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'unpaid' },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      transaction_id: { type: DataTypes.STRING(64), allowNull: false, defaultValue: '' },
      refund_id: { type: DataTypes.STRING(64), allowNull: false, defaultValue: '' },
      refunded_at: { type: DataTypes.DATE, allowNull: true },
      refund_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      refund_reason: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      refund_policy: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'flexible' },
      billing_type: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'fixed' },
      hourly_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      abort_reason: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      aborted_at: { type: DataTypes.DATE, allowNull: true },
      actual_fee: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      cancel_reason: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      finish_remark: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      rating: { type: DataTypes.TINYINT, allowNull: true },
      rate_comment: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      rate_skill: { type: DataTypes.TINYINT, allowNull: true },
      rate_attitude: { type: DataTypes.TINYINT, allowNull: true },
      rate_punctual: { type: DataTypes.TINYINT, allowNull: true },
      rate_tags: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
      worker_rating: { type: DataTypes.TINYINT, allowNull: true },
      worker_rate_comment: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      worker_rate_tags: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
      dispatch_at: { type: DataTypes.DATE, allowNull: true },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'orders',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['status', 'created_at'] },
        { fields: ['customer_id'] },
        { fields: ['worker_id'] },
      ],
    },
  );
}
