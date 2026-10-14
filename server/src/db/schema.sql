-- ============================================================
-- 接派 · 上门服务接单派单平台 —— 数据库结构
-- MySQL 8.x / 9.x   字符集 utf8mb4
-- 执行方式：node server/src/db/init.js   （自动建库建表 + 灌入种子数据）
-- ============================================================

CREATE TABLE IF NOT EXISTS `users` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `phone`      VARCHAR(20)  NOT NULL COMMENT '手机号（登录账号）',
  `password`   VARCHAR(100) NOT NULL COMMENT 'bcrypt 密码',
  `name`       VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '昵称',
  `avatar`     VARCHAR(255) NOT NULL DEFAULT '' COMMENT '头像 URL',
  `role`       ENUM('admin','customer','worker') NOT NULL DEFAULT 'customer' COMMENT '角色',
  `status`     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 正常 0 停用',
  `openid`     VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '微信小程序 openid（JSAPI 下单用，code2session 后缓存）',
  `rating`     DECIMAL(2,1) NOT NULL DEFAULT 5.0 COMMENT '客户被评均分（师傅→客户）',
  `restricted` TINYINT      NOT NULL DEFAULT 0 COMMENT '1 受限（近 N 单均分过低，禁止下单）',
  `restricted_reason` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '受限原因',
  `restricted_until`  DATETIME NULL COMMENT '受限解除时间',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_phone` (`phone`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='账号表';

CREATE TABLE IF NOT EXISTS `service_categories` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(50)  NOT NULL COMMENT '类目名',
  `icon`        VARCHAR(20)  NOT NULL DEFAULT '🔧' COMMENT '展示图标（emoji）',
  `min_price`   DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '起步价',
  `unit`        VARCHAR(20)  NOT NULL DEFAULT '起' COMMENT '计价单位，如 次/件/起',
  `description` VARCHAR(255) NOT NULL DEFAULT '',
  `sort`        INT          NOT NULL DEFAULT 0 COMMENT '排序，越大越靠前',
  `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '1 上架 0 下架',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sort` (`sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='服务类目';

CREATE TABLE IF NOT EXISTS `workers` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      INT UNSIGNED NOT NULL COMMENT '关联 users.id',
  `real_name`    VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '真实姓名',
  `id_card`      VARCHAR(30)  NOT NULL DEFAULT '' COMMENT '身份证号（演示用）',
  `region`       VARCHAR(100) NOT NULL DEFAULT '' COMMENT '服务区域',
  `skills`       VARCHAR(255) NOT NULL DEFAULT '' COMMENT '可接类目 id，逗号分隔',
  `years`        INT          NOT NULL DEFAULT 0 COMMENT '从业年限',
  `bio`          VARCHAR(255) NOT NULL DEFAULT '' COMMENT '个人简介',
  `rating`       DECIMAL(3,1) NOT NULL DEFAULT 5.0 COMMENT '评分',
  `order_count`  INT          NOT NULL DEFAULT 0 COMMENT '累计接单',
  `done_count`   INT          NOT NULL DEFAULT 0 COMMENT '累计完成',
  `status`       ENUM('pending','approved','rejected','disabled') NOT NULL DEFAULT 'pending' COMMENT '认证状态',
  `audit_remark` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '审核备注',
  `audited_at`   DATETIME     NULL COMMENT '审核时间',
  `restricted`   TINYINT      NOT NULL DEFAULT 0 COMMENT '1 受限（近 N 单均分过低，禁止接单/派单）',
  `restricted_reason` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '受限原因',
  `restricted_until`  DATETIME NULL COMMENT '受限解除时间',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user` (`user_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='服务者（师傅）档案';

CREATE TABLE IF NOT EXISTS `orders` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no`       VARCHAR(32)  NOT NULL COMMENT '订单号',
  `customer_id`    INT UNSIGNED NOT NULL COMMENT '下单客户 users.id',
  `worker_id`      INT UNSIGNED NULL COMMENT '接单师傅 workers.id，未接为空',
  `category_id`    INT UNSIGNED NULL COMMENT '服务类目；自定义类型订单为 NULL',
  `custom_category` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '自定义服务类型（category_id 为空时生效）',
  `title`          VARCHAR(100) NOT NULL COMMENT '订单标题',
  `description`    TEXT         NULL COMMENT '需求描述',
  `address`        VARCHAR(255) NOT NULL DEFAULT '' COMMENT '上门地址',
  `lng`            DECIMAL(10,6) NULL COMMENT '经度',
  `lat`            DECIMAL(10,6) NULL COMMENT '纬度',
  `expect_at`      DATETIME     NULL COMMENT '期望上门时间',
  `budget`         DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '客户预估/预算金额',
  `price`          DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '实际结算金额（完工时填写）',
  `service_fee`    DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '平台服务费',
  `status`         ENUM('pending','dispatched','accepted','working','finished','aborted','completed','cancelled') NOT NULL DEFAULT 'pending' COMMENT '订单状态（aborted=中途结束）',
  `source`         ENUM('customer','admin') NOT NULL DEFAULT 'customer' COMMENT '下单来源',
  `pay_status`     VARCHAR(16) NOT NULL DEFAULT 'unpaid' COMMENT '支付状态 unpaid/paid/refunded',
  `paid_at`        DATETIME     NULL COMMENT '支付成功时间',
  `transaction_id` VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '微信支付单号（mock 时为 MOCK+时间戳）',
  `refund_id`      VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '微信退款单号',
  `refunded_at`    DATETIME     NULL COMMENT '退款时间',
  `refund_amount`  DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '实际退款金额',
  `refund_reason`  VARCHAR(255) NOT NULL DEFAULT '' COMMENT '退款原因',
  -- 下单锁定的退款政策与计费方式（不可变）
  `refund_policy`  VARCHAR(16) NOT NULL DEFAULT 'flexible' COMMENT 'flexible 支持中途退款 / strict 不可中途退款',
  `billing_type`   VARCHAR(16) NOT NULL DEFAULT 'fixed'    COMMENT 'fixed 一口价 / hourly 时薪',
  `hourly_price`   DECIMAL(10,2) NOT NULL DEFAULT 0        COMMENT '时薪（billing_type=hourly）',
  -- 中途结束（aborted）
  `abort_reason`   VARCHAR(255) NOT NULL DEFAULT '' COMMENT '中途结束原因',
  `aborted_at`     DATETIME     NULL COMMENT '中途结束时间',
  `actual_fee`     DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '中途结算实收金额',
  `cancel_reason`  VARCHAR(255) NOT NULL DEFAULT '',
  `finish_remark`  VARCHAR(255) NOT NULL DEFAULT '' COMMENT '师傅完工备注',
  `rating`         TINYINT      NULL COMMENT '客户评价 1-5（总分）',
  `rate_comment`   VARCHAR(255) NOT NULL DEFAULT '',
  -- 多维评价（客户→师傅）
  `rate_skill`     TINYINT      NULL COMMENT '技术 1-5',
  `rate_attitude`  TINYINT      NULL COMMENT '态度 1-5',
  `rate_punctual`  TINYINT      NULL COMMENT '准时 1-5',
  `rate_tags`      VARCHAR(200) NOT NULL DEFAULT '' COMMENT '快捷标签，逗号分隔',
  -- 双向评价（师傅→客户）
  `worker_rating`      TINYINT      NULL COMMENT '客户配合度 1-5',
  `worker_rate_comment` VARCHAR(255) NOT NULL DEFAULT '',
  `worker_rate_tags`    VARCHAR(200) NOT NULL DEFAULT '',
  `dispatch_at`    DATETIME     NULL COMMENT '派单时间',
  `accepted_at`    DATETIME     NULL,
  `started_at`     DATETIME     NULL,
  `finished_at`    DATETIME     NULL,
  `completed_at`   DATETIME     NULL,
  `cancelled_at`   DATETIME     NULL,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_no` (`order_no`),
  KEY `idx_status_time` (`status`, `created_at`),
  KEY `idx_customer` (`customer_id`),
  KEY `idx_worker` (`worker_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单表';

CREATE TABLE IF NOT EXISTS `order_logs` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`      INT UNSIGNED NOT NULL,
  `action`        VARCHAR(30)  NOT NULL COMMENT 'create/dispatch/accept/start/finish/confirm/cancel/rate/pay/refund',
  `from_status`   VARCHAR(20)  NOT NULL DEFAULT '',
  `to_status`     VARCHAR(20)  NOT NULL DEFAULT '',
  `operator_id`   INT UNSIGNED NULL COMMENT '操作人 users.id',
  `operator_role` VARCHAR(20)  NOT NULL DEFAULT '' COMMENT 'admin/customer/worker',
  `content`       VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单操作流水';

CREATE TABLE IF NOT EXISTS `wallets` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `balance`    DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '可用余额',
  `income`     DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '累计收入',
  `withdrawn`  DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '累计提现',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='钱包';

CREATE TABLE IF NOT EXISTS `wallet_logs` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED NOT NULL,
  `order_id`      INT UNSIGNED NULL,
  `type`          ENUM('income','withdraw','refund') NOT NULL DEFAULT 'income',
  `amount`        DECIMAL(10,2) NOT NULL COMMENT '正为入账 负为出账',
  `balance_after` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `remark`        VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='钱包流水';

-- ============================================================
-- 站内通知（docs/DESIGN-phase2.md §1）
-- ============================================================
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL COMMENT '接收人 users.id',
  `order_id`   INT UNSIGNED NULL COMMENT '关联订单（可空）',
  `type`       VARCHAR(32)  NOT NULL COMMENT 'dispatch/accept/start_remind/start_timeout/finish/confirm/refund/rate/restrict/abort',
  `title`      VARCHAR(100) NOT NULL,
  `content`    VARCHAR(255) NOT NULL,
  `is_read`    TINYINT      NOT NULL DEFAULT 0 COMMENT '0 未读 1 已读',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`, `is_read`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内通知';
