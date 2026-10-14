#!/bin/bash
# 接派后端 API 阶段二测试：中途退出/退款政策/通知/多维评价/低分限制
# 依赖：先跑 api-test.sh（会重置库）；本脚本用 KEEP_DB 语义直接在当前库上跑
# 运行：bash scripts/api-test-phase2.sh
set -e
PASS=0; FAIL=0
SRV_DIR="$(cd "$(dirname "$0")/.." && pwd)/server"
BASE=http://127.0.0.1:7010/api

cd "$SRV_DIR"

check() { # name expected_fragment actual
  local name="$1" expect="$2" actual="$3"
  if echo "$actual" | grep -q "$expect"; then
    PASS=$((PASS+1)); echo "✅ $name"
  else
    FAIL=$((FAIL+1)); echo "❌ $name"; echo "   期望包含: $expect"; echo "   实际: $(echo $actual | head -c 300)"
  fi
}

j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1],{'d':d}))" "$1"; }

# run_sql SQL —— mysql2 直连执行（服务端 TS 迁移后 node -e require 不可用，此法前后兼容）
run_sql() { node "$SRV_DIR/scripts/run-sql.mjs" "$1" >/dev/null; }

# check_num 名称 期望数值 python取值表达式(基于d) json串 —— 金额字段 DECIMAL 可能是 "60"/"60.00"/60，统一数值比较
check_num() {
  local name="$1" expect="$2" expr="$3" json="$4"
  local got
  got=$(echo "$json" | python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1],{'d':d}))" "$expr" 2>/dev/null || echo "")
  if python3 -c "import sys; sys.exit(0 if abs(float(sys.argv[1]) - float(sys.argv[2])) < 0.01 else 1)" "$got" "$expect" 2>/dev/null; then
    PASS=$((PASS+1)); echo "✅ $name"
  else
    FAIL=$((FAIL+1)); echo "❌ $name"; echo "   期望: $expect 实际: ${got:-取值失败}"
  fi
}

# --- 登录三端 ---
ADMIN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13900000000","password":"admin123"}')
AT=$(echo "$ADMIN" | j "d['data']['token']")
CUST=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13800000001","password":"123456"}')
CT=$(echo "$CUST" | j "d['data']['token']")
WORK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13800000011","password":"123456"}')
WT=$(echo "$WORK" | j "d['data']['token']")
CID=$(curl -s $BASE/categories | j "d['data']['list'][0]['id']")

mk_order() { # $1=extra_json $2=title
  curl -s -X POST $BASE/orders -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
    -d "{\"category_id\":$CID,\"title\":\"$2\",\"address\":\"深圳市南山区测试路9号\",\"budget\":100$1}"
}

# ========== 1. 下单锁定字段 ==========
O1=$(mk_order ',"refund_policy":"strict","billing_type":"hourly","hourly_price":60' "阶段二-strict时薪单")
check "下单锁定 refund_policy" '"refund_policy":"strict"' "$O1"
check "下单锁定 billing_type" '"billing_type":"hourly"' "$O1"
check_num "时薪回显" 60 "d['data']['order']['hourly_price']" "$O1"
O1ID=$(echo "$O1" | j "d['data']['order']['id']")

O2=$(mk_order ',"refund_policy":"flexible"' "阶段二-flexible单")
O2ID=$(echo "$O2" | j "d['data']['order']['id']")

# ========== 2. 派单→接单→开工 链路（aborted 前置） ==========
WLIST=$(curl -s "$BASE/admin/workers?status=approved" -H "Authorization: Bearer $AT")
WID=$(echo "$WLIST" | python3 -c "import sys,json;d=json.load(sys.stdin);print([w['id'] for w in d['data']['list'] if w['phone']=='13800000011'][0])")

curl -s -X POST $BASE/admin/orders/$O1ID/dispatch -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"worker_id\":$WID}" >/dev/null
curl -s -X POST $BASE/orders/$O1ID/accept -H "Authorization: Bearer $WT" >/dev/null
curl -s -X POST $BASE/orders/$O1ID/start -H "Authorization: Bearer $WT" >/dev/null

# ========== 3. 中途退出 aborted ==========
# 3a. fixed/此处是 hourly 单：服务端按时长自动算，先回拨 started_at 到 40 分钟前
run_sql "UPDATE orders SET started_at = DATE_SUB(NOW(), INTERVAL 40 MINUTE) WHERE id = $O1ID"
ABORT=$(curl -s -X POST $BASE/orders/$O1ID/abort -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{"reason":"家中突发急事"}')
check "中途退出→aborted" '"status":"aborted"' "$ABORT"
# 40 分钟 → ceil(40/30)=2 个半小时 = 1h → 60×1.0 = 60
check_num "hourly 实收=时薪×1h" 60 "d['data']['order']['actual_fee']" "$ABORT"
check "中止原因落库" '家中突发急事' "$ABORT"
check "中止时间落库" '"aborted_at":"' "$ABORT"

# 3b. 重复中止 409（非 working）
ABORT2=$(curl -s -X POST $BASE/orders/$O1ID/abort -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{"reason":"再来一次"}')
check "非 working 中止 409" '"code":409' "$ABORT2"

# 3c. 缺原因 400
O3=$(mk_order '' "阶段二-缺原因中止")
O3ID=$(echo "$O3" | j "d['data']['order']['id']")
curl -s -X POST $BASE/admin/orders/$O3ID/dispatch -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"worker_id\":$WID}" >/dev/null
curl -s -X POST $BASE/orders/$O3ID/accept -H "Authorization: Bearer $WT" >/dev/null
curl -s -X POST $BASE/orders/$O3ID/start -H "Authorization: Bearer $WT" >/dev/null
NOREASON=$(curl -s -X POST $BASE/orders/$O3ID/abort -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{"reason":""}')
check "中止缺原因 400" '"code":400' "$NOREASON"

# ========== 4. aborted → confirm 结算（按 actual_fee） ==========
BAL_BEFORE=$(curl -s "$BASE/admin/wallets?keyword=13800000011" -H "Authorization: Bearer $AT" | j "d['data']['list'][0]['balance']")
CONF=$(curl -s -X POST $BASE/orders/$O1ID/confirm -H "Authorization: Bearer $CT")
check "aborted 可确认结算" '"status":"completed"' "$CONF"
BAL_AFTER=$(curl -s "$BASE/admin/wallets?keyword=13800000011" -H "Authorization: Bearer $AT" | j "d['data']['list'][0]['balance']")
# actual_fee=60, 10% 抽成 → 入账 54
python3 -c "import sys; b=float('$BAL_BEFORE'); a=float('$BAL_AFTER'); sys.exit(0 if abs((a-b)-54.0)<0.01 else 1)" \
  && { PASS=$((PASS+1)); echo "✅ 结算按 actual_fee 入账 54"; } \
  || { FAIL=$((FAIL+1)); echo "❌ 入账差额=$(( $(echo "$BAL_AFTER"-$BAL_BEFORE) )) 期望 54"; }

# ========== 5. 退款政策矩阵 ==========
# 5a. strict + working 中客户取消 → 409
O4=$(mk_order ',"refund_policy":"strict"' "阶段二-strict取消测试")
O4ID=$(echo "$O4" | j "d['data']['order']['id']")
curl -s -X POST $BASE/admin/orders/$O4ID/dispatch -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"worker_id\":$WID}" >/dev/null
curl -s -X POST $BASE/orders/$O4ID/accept -H "Authorization: Bearer $WT" >/dev/null
curl -s -X POST $BASE/orders/$O4ID/start -H "Authorization: Bearer $WT" >/dev/null
SREF=$(curl -s -X POST $BASE/orders/$O4ID/cancel -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"reason":"不想要了"}')
check "strict 服务中取消 409" '不支持中途退款' "$SREF"

# 5b. 开工前取消已支付单 → 全额退款
O5=$(mk_order '' "阶段二-开工前退款")
O5ID=$(echo "$O5" | j "d['data']['order']['id']")
curl -s -X POST $BASE/pay/orders/$O5ID -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"code":""}' >/dev/null
PRE_CANCEL=$(curl -s -X POST $BASE/orders/$O5ID/cancel -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"reason":"时间冲突"}')
check "开工前取消→已退款" '"pay_status":"refunded"' "$PRE_CANCEL"
check_num "退款金额=全额" 100 "d['data']['order']['refund_amount']" "$PRE_CANCEL"
check "退款原因(开工前)" '开工前取消' "$PRE_CANCEL"

# ========== 6. 通知 ==========
NOTI=$(curl -s "$BASE/notifications?page=1" -H "Authorization: Bearer $WT")
check "师傅通知列表" '"unread_count"' "$NOTI"
check "派单事件已通知" '派单' "$NOTI"
NOTI_C=$(curl -s "$BASE/notifications?page=1" -H "Authorization: Bearer $CT")
check "客户通知列表" '"unread_count"' "$NOTI_C"
READ=$(curl -s -X POST $BASE/notifications/read -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{}')
check "全部已读 unread=0" '"unread_count":0' "$READ"
NOTI401=$(curl -s "$BASE/notifications")
check "通知未登录 401" '"code":401' "$NOTI401"

# ========== 7. 多维评价 + 双向 ==========
# O1 已 completed：先用非法 payload 测校验（此时必须还没评价，顺序敏感）
RATE_BAD=$(curl -s -X POST $BASE/orders/$O1ID/rate -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"rating":3,"skill":9}')
check "维度超5分 400" '"code":400' "$RATE_BAD"
RATE_TAGS=$(curl -s -X POST $BASE/orders/$O1ID/rate -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
  -d '{"rating":3,"tags":["a","b","c","d"]}')
check "标签超3个 400" '"code":400' "$RATE_TAGS"

# 再合法评价
RATE=$(curl -s -X POST $BASE/orders/$O1ID/rate -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
  -d '{"rating":5,"skill":4,"attitude":5,"punctual":3,"tags":["技术专业","准时到达"],"comment":"服务不错"}')
check "多维评价成功" '"rate_skill":4' "$RATE"
check "评价标签落库" '技术专业' "$RATE"
RATE2=$(curl -s -X POST $BASE/orders/$O1ID/rate -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"rating":1}')
check "重复评价 409" '"code":409' "$RATE2"

# 师傅回评客户
WRATE=$(curl -s -X POST $BASE/orders/$O1ID/rate-worker -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' \
  -d '{"rating":4,"tags":["沟通顺畅"],"comment":"客户很好"}')
check "师傅回评客户" '"worker_rating":4' "$WRATE"
WRATE2=$(curl -s -X POST $BASE/orders/$O1ID/rate-worker -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{"rating":1}')
check "重复回评 409" '"code":409' "$WRATE2"
WRATE_FORBID=$(curl -s -X POST $BASE/orders/$O1ID/rate-worker -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"rating":1}')
check "非接单人回评 403" '"code":403' "$WRATE_FORBID"

# ========== 8. 低分限制 + 解除 ==========
# 8a. 把该师傅历史评过分的单压到 1.0（workers 无 phone 列，经 user_id 关联 users）
run_sql "UPDATE orders SET rating = 1.0 WHERE worker_id IN (SELECT id FROM workers WHERE user_id = (SELECT id FROM users WHERE phone='13800000011')) AND rating IS NOT NULL"

# 8b. 真实触发链路：完成 O3 → 客户评 1 星 → 近5单均分<3 → 自动 restricted=1
curl -s -X POST $BASE/orders/$O3ID/finish -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{"price":100}' >/dev/null
curl -s -X POST $BASE/orders/$O3ID/confirm -H "Authorization: Bearer $CT" >/dev/null
TRIGGER_RATE=$(curl -s -X POST $BASE/orders/$O3ID/rate -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"rating":1,"skill":1,"attitude":1,"punctual":1,"comment":"很差"}')
check "低星评价提交成功" '"rating":1' "$TRIGGER_RATE"
WLIST2=$(curl -s "$BASE/admin/workers?keyword=13800000011" -H "Authorization: Bearer $AT")
check "低分自动触发受限" '"restricted":1' "$WLIST2"

# 8c. 受限师傅被派单 403
O6=$(mk_order '' "阶段二-受限拦截")
O6ID=$(echo "$O6" | j "d['data']['order']['id']")
DISP_R=$(curl -s -X POST $BASE/admin/orders/$O6ID/dispatch -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"worker_id\":$WID}")
check "受限师傅被派单 403" '"code":403' "$DISP_R"

# 8d. 客户下单拦截（客户侧真实触发需多单互评，SQL 置位验证拦截本身）
run_sql "UPDATE users SET restricted = 1, restricted_reason = '测试受限', restricted_until = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE phone = '13800000001'"
ORD_R=$(mk_order '' "阶段二-客户受限")
check "受限客户下单 403" '"code":403' "$ORD_R"

# 8e. 到期自动解除：师傅 until 改到过去 → 下一单派单应成功；客户清零恢复后续流程
run_sql "UPDATE workers SET restricted_until = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = (SELECT id FROM users WHERE phone='13800000011')"
run_sql "UPDATE users SET restricted = 0, restricted_reason = '', restricted_until = NULL WHERE phone = '13800000001'"
DISP_OK=$(curl -s -X POST $BASE/admin/orders/$O6ID/dispatch -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"worker_id\":$WID}")
check "到期自动解除后可派单" '"status":"dispatched"' "$DISP_OK"

# 8f. 运营手动解除：重新置受限 → unrestrict → 新单可派
run_sql "UPDATE workers SET restricted = 1, restricted_reason = '手动测试', restricted_until = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE user_id = (SELECT id FROM users WHERE phone='13800000011')"
UNR=$(curl -s -X POST $BASE/admin/workers/$WID/unrestrict -H "Authorization: Bearer $AT")
check "运营解除师傅限制" '"restricted":0' "$UNR"
O8=$(mk_order '' "阶段二-解除后派单")
O8ID=$(echo "$O8" | j "d['data']['order']['id']")
DISP_OK2=$(curl -s -X POST $BASE/admin/orders/$O8ID/dispatch -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"worker_id\":$WID}")
check "解除后可正常派单" '"status":"dispatched"' "$DISP_OK2"

# ========== 9. 运营手动退款带金额 ==========
O7=$(mk_order '' "阶段二-手动退款")
O7ID=$(echo "$O7" | j "d['data']['order']['id']")
curl -s -X POST $BASE/pay/orders/$O7ID -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"code":""}' >/dev/null
MREF=$(curl -s -X POST $BASE/admin/orders/$O7ID/refund -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d '{"amount":30,"reason":"部分补偿"}')
check_num "手动部分退款成功" 30 "d['data']['order']['refund_amount']" "$MREF"
check "退款原因落库" '部分补偿' "$MREF"

# ========== 10. aborted 状态筛选/分布 ==========
# 先造一个 aborted 单（O1 已走完 completed，库里需新造）
O9=$(mk_order '' "阶段二-筛选用中止单")
O9ID=$(echo "$O9" | j "d['data']['order']['id']")
curl -s -X POST $BASE/admin/orders/$O9ID/dispatch -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"worker_id\":$WID}" >/dev/null
curl -s -X POST $BASE/orders/$O9ID/accept -H "Authorization: Bearer $WT" >/dev/null
curl -s -X POST $BASE/orders/$O9ID/start -H "Authorization: Bearer $WT" >/dev/null
curl -s -X POST $BASE/orders/$O9ID/abort -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{"reason":"筛选测试","price":20}' >/dev/null
LIST=$(curl -s "$BASE/admin/orders?status=aborted&page=1" -H "Authorization: Bearer $AT")
check "列表按 aborted 筛选" '"order_no"' "$LIST"
check "筛选结果为中止单" '筛选用中止单' "$LIST"

echo ""
echo "================ 阶段二结果：PASS=$PASS FAIL=$FAIL ================"
[ "$FAIL" -eq 0 ]
