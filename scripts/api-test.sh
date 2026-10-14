#!/bin/bash
# 接派后端 API 冒烟测试
# 默认会重置数据库以保证结果可重复；加 KEEP_DB=1 跳过重置
set -e
PASS=0; FAIL=0
SRV_DIR="$(cd "$(dirname "$0")/.." && pwd)/server"
BASE=http://127.0.0.1:7010/api

cd "$SRV_DIR"
if [ -z "$KEEP_DB" ]; then
  echo "--- 重置数据库 ---"
  # 兼容迁移前后：TS 迁移后用 tsx，迁移前用 node
  if [ -f src/db/init.ts ]; then
    npx tsx src/db/init.ts --reset >/dev/null
    npx tsx src/db/seed.ts >/dev/null
  else
    node src/db/init.js --reset >/dev/null
    node src/db/seed.js >/dev/null
  fi
  echo "--- 数据库就绪 ---"
fi

check() { # name expected_fragment actual
  local name="$1" expect="$2" actual="$3"
  if echo "$actual" | grep -q "$expect"; then
    PASS=$((PASS+1)); echo "✅ $name"
  else
    FAIL=$((FAIL+1)); echo "❌ $name"; echo "   期望包含: $expect"; echo "   实际: $(echo $actual | head -c 300)"
  fi
}

j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1],{'d':d}))" "$1"; }

# --- 登录 ---
ADMIN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13900000000","password":"admin123"}')
check "运营登录" '"role":"admin"' "$ADMIN"
AT=$(echo "$ADMIN" | j "d['data']['token']")

CUST=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13800000001","password":"123456"}')
check "客户登录" '"role":"customer"' "$CUST"
CT=$(echo "$CUST" | j "d['data']['token']")

WORK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13800000011","password":"123456"}')
check "师傅登录(验证码)" '"role":"worker"' "$WORK"
WT=$(echo "$WORK" | j "d['data']['token']")

BADPW=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13900000000","password":"wrong"}')
check "密码错误 401" '"code":401' "$BADPW"

NOAUTH=$(curl -s $BASE/orders/mine)
check "未登录 401" '"code":401' "$NOAUTH"

# --- 首页 / 类目 ---
HOME_DATA=$(curl -s $BASE/home)
check "首页数据" '"categories"' "$HOME_DATA"
CATS=$(curl -s $BASE/categories)
check "类目列表" '"name"' "$CATS"
CID=$(echo "$CATS" | j "d['data']['list'][0]['id']")

# --- 下单 ---
ORDER=$(curl -s -X POST $BASE/orders -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
  -d "{\"category_id\":$CID,\"title\":\"测试-空调清洗\",\"description\":\"两台挂机\",\"address\":\"深圳市南山区测试路1号\",\"expect_at\":\"2026-10-13 10:00:00\",\"budget\":150}")
check "客户下单" '"order_no"' "$ORDER"
OID=$(echo "$ORDER" | j "d['data']['order']['id']")
ST=$(echo "$ORDER" | j "d['data']['order']['status']")

# --- 详情 ---
DETAIL=$(curl -s $BASE/orders/$OID -H "Authorization: Bearer $CT")
check "订单详情(客户)" '"客户提交需求"' "$DETAIL"

OTHER=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13800000002","password":"123456"}')
OT=$(echo "$OTHER" | j "d['data']['token']")
NOSEE=$(curl -s $BASE/orders/$OID -H "Authorization: Bearer $OT")
check "他人不可见 403" '"code":403' "$NOSEE"

# --- 运营派单 ---
WLIST=$(curl -s "$BASE/admin/workers?status=approved" -H "Authorization: Bearer $AT")
check "师傅列表" '"real_name"' "$WLIST"
# 指定派给 13800000011（李建国），保证与后续登录的师傅一致
WID=$(echo "$WLIST" | python3 -c "import sys,json;d=json.load(sys.stdin);print([w['id'] for w in d['data']['list'] if w['phone']=='13800000011'][0])")

DISP=$(curl -s -X POST $BASE/admin/orders/$OID/dispatch -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"worker_id\":$WID}")
check "运营派单" '"status":"dispatched"' "$DISP"
check "派单指定师傅" '"worker_name":"李建国"' "$DISP"

# --- 非管理员访问管理端 ---
FORBID=$(curl -s $BASE/admin/dashboard -H "Authorization: Bearer $CT")
check "客户访问管理端 403" '"code":403' "$FORBID"

# --- 师傅流程 ---
ACC=$(curl -s -X POST $BASE/orders/$OID/accept -H "Authorization: Bearer $WT")
check "师傅接单" '"status":"accepted"' "$ACC"

# 已接单订单不可再派单
DISP2=$(curl -s -X POST $BASE/admin/orders/$OID/dispatch -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"worker_id\":$WID}")
check "已接单再派单 409" '"code":409' "$DISP2"

ST2=$(curl -s -X POST $BASE/orders/$OID/start -H "Authorization: Bearer $WT")
check "开始服务" '"status":"working"' "$ST2"

FIN=$(curl -s -X POST $BASE/orders/$OID/finish -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{"price":160,"remark":"清洗完成"}')
check "提交完工" '"status":"finished"' "$FIN"
check "服务费计提" '"service_fee":16' "$FIN"

CONF=$(curl -s -X POST $BASE/orders/$OID/confirm -H "Authorization: Bearer $CT")
check "客户确认完成" '"status":"completed"' "$CONF"

RATE=$(curl -s -X POST $BASE/orders/$OID/rate -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"rating":5,"comment":"很专业"}')
check "评价" '"rating":5' "$RATE"

WALLET=$(curl -s $BASE/wallet -H "Authorization: Bearer $WT")
check "师傅钱包入账(124.2+144=268.2)" '"balance":268.2' "$WALLET"

# --- 抢单并发/状态冲突 ---
PENDING=$(curl -s "$BASE/orders?status=pending&page_size=1" -H "Authorization: Bearer $WT")
PID=$(echo "$PENDING" | j "d['data']['list'][0]['id']")
# 先让另一个师傅（13800000012）抢
W2=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13800000012","password":"123456"}')
W2T=$(echo "$W2" | j "d['data']['token']")
GRAB=$(curl -s -X POST $BASE/orders/$PID/accept -H "Authorization: Bearer $W2T")
check "师傅抢单" '"status":"accepted"' "$GRAB"
GRAB2=$(curl -s -X POST $BASE/orders/$PID/accept -H "Authorization: Bearer $WT")
check "重复抢单 409" '"code":409' "$GRAB2"

# --- 我的订单 ---
MINE_C=$(curl -s "$BASE/orders/mine?role=customer" -H "Authorization: Bearer $CT")
check "我的订单(客户)" '"total"' "$MINE_C"
MINE_W=$(curl -s "$BASE/orders/mine?role=worker" -H "Authorization: Bearer $WT")
check "我的订单(师傅)" '"total"' "$MINE_W"

# --- 师傅统计 / 档案 ---
STATS=$(curl -s $BASE/worker/stats -H "Authorization: Bearer $WT")
check "师傅统计" '"done"' "$STATS"
PROF=$(curl -s $BASE/worker/profile -H "Authorization: Bearer $WT")
check "师傅档案" '"real_name"' "$PROF"

# --- 管理端 ---
DASH=$(curl -s $BASE/admin/dashboard -H "Authorization: Bearer $AT")
check "看板数据" '"trend"' "$DASH"
check "看板状态分布" '"status_dist"' "$DASH"

ORDD=$(curl -s "$BASE/admin/orders?status=pending&page=1&page_size=5" -H "Authorization: Bearer $AT")
check "管理端订单分页" '"page_size":5' "$ORDD"
ODID=$(echo "$ORDD" | j "d['data']['list'][0]['id']")
ODDET=$(curl -s $BASE/admin/orders/$ODID -H "Authorization: Bearer $AT")
check "管理端订单详情" '"logs"' "$ODDET"

CUSTL=$(curl -s "$BASE/admin/customers?keyword=138" -H "Authorization: Bearer $AT")
check "客户列表" '"total_spent"' "$CUSTL"

CATL=$(curl -s $BASE/admin/categories -H "Authorization: Bearer $AT")
check "管理端类目" '"min_price"' "$CATL"
NEWCAT=$(curl -s -X POST $BASE/admin/categories -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"name":"测试类目","icon":"🧪","min_price":10,"unit":"次","description":"自动化测试","sort":1,"status":1}')
NCID=$(echo "$NEWCAT" | j "d['data']['id']")
UPDCAT=$(curl -s -X PUT $BASE/admin/categories/$NCID -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"name":"测试类目改","icon":"🧪","min_price":20,"unit":"次","sort":1,"status":1}')
check "类目更新返回 id" '"id"' "$UPDCAT"
CATONE=$(curl -s $BASE/admin/categories -H "Authorization: Bearer $AT")
check "类目已更新" '测试类目改' "$CATONE"
DELCAT=$(curl -s -X DELETE $BASE/admin/categories/$NCID -H "Authorization: Bearer $AT")
check "类目删除" '"id"' "$DELCAT"

WALLETS=$(curl -s $BASE/admin/wallets -H "Authorization: Bearer $AT")
check "钱包列表" '"income"' "$WALLETS"
WLOGS=$(curl -s $BASE/admin/wallet-logs -H "Authorization: Bearer $AT")
check "流水列表" '"balance_after"' "$WLOGS"

# --- 师傅审核 ---
WL=$(curl -s "$BASE/admin/workers?status=pending" -H "Authorization: Bearer $AT")
PENDID=$(echo "$WL" | j "d['data']['list'][0]['id']")
if [ "$PENDID" != "None" ] && [ -n "$PENDID" ]; then
  AUD=$(curl -s -X POST $BASE/admin/workers/$PENDID/audit -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"status":"approved","remark":"资料齐全"}')
  check "师傅审核通过" '"status":"approved"' "$AUD"
else
  echo "ℹ️  没有待审核师傅（跳过）"
fi

# --- 入驻申请 ---
NEWWORKER=$(curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' -d '{"phone":"13800000099","code":"123456","password":"123456","name":"新师傅","role":"worker"}')
NWT=$(echo "$NEWWORKER" | j "d['data']['token']")
APPLY=$(curl -s -X POST $BASE/worker/apply -H "Authorization: Bearer $NWT" -H 'Content-Type: application/json' -d "{\"real_name\":\"新师傅\",\"id_card\":\"440301199001011234\",\"region\":\"宝安区\",\"skills\":[$CID],\"years\":2,\"bio\":\"两年经验\"}")
check "师傅入驻提交" '"status":"pending"' "$APPLY"

# --- 运营代客下单 ---
ADMINORD=$(curl -s -X POST $BASE/admin/orders -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"customer_phone\":\"13800000003\",\"category_id\":$CID,\"title\":\"运营代下单\",\"address\":\"测试地址\",\"budget\":99}")
check "运营代客下单" '"source":"admin"' "$ADMINORD"

# --- 取消 ---
CANCEL=$(curl -s -X POST $BASE/admin/orders/$PID/cancel -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"reason":"客户改期"}')
check "运营取消订单" '"status":"cancelled"' "$CANCEL"

# --- 自定义服务类型 ---
CUSTOM_ORD=$(curl -s -X POST $BASE/orders -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
  -d '{"custom_category":"宠物寄养上门","title":"猫咪上门喂食","address":"深圳市南山区学府路1号","budget":66,"lat":22.53,"lng":113.94}')
check "自定义类型下单" '"is_custom":true' "$CUSTOM_ORD"
check "自定义类型名回显" '宠物寄养上门' "$CUSTOM_ORD"
check "自定义类型图标" '"category_icon":"📋"' "$CUSTOM_ORD"
check "自定义订单 category_id 为空" '"category_id":null' "$CUSTOM_ORD"

NO_TYPE=$(curl -s -X POST $BASE/orders -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
  -d '{"title":"缺类型","address":"某地","budget":10}')
check "无服务类型 400" '"code":400' "$NO_TYPE"

LONG_TYPE=$(curl -s -X POST $BASE/orders -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
  -d "{\"custom_category\":\"$(python3 -c 'print("字"*31)')\",\"title\":\"超长\",\"address\":\"某地\",\"budget\":10}")
check "自定义类型超30字 400" '"code":400' "$LONG_TYPE"

# 运营代下单也支持自定义类型 + 坐标
ADMIN_CUSTOM=$(curl -s -X POST $BASE/admin/orders -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d '{"customer_phone":"13800000002","custom_category":"古琴搬运","title":"乐器搬运","address":"深圳市福田区","budget":300,"lng":114.05,"lat":22.54}')
check "运营代下单-自定义类型" '"is_custom":true' "$ADMIN_CUSTOM"

# --- 服务类型数量（内置 16 个） ---
CAT_ALL=$(curl -s $BASE/categories)
CAT_N=$(echo "$CAT_ALL" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['list']))")
if [ "$CAT_N" = "16" ]; then PASS=$((PASS+1)); echo "✅ 内置 16 个服务类型"; else FAIL=$((FAIL+1)); echo "❌ 服务类型数量=$CAT_N 期望 16"; fi

# --- 头像上传（微信头像昵称能力） ---
AV_FILE="$HOME/.cache/opencode-jiepai/_avatar_test.png"
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$AV_FILE"
AV=$(curl -s -X POST $BASE/user/avatar -H "Authorization: Bearer $CT" -F "file=@$AV_FILE;type=image/png")
check "头像上传返回 URL" '/uploads/avatar/' "$AV"
AVURL=$(echo "$AV" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['user']['avatar'])" 2>/dev/null || echo "")
AV_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:7010$AVURL")
check "头像静态可访问(200)" "200" "$AV_CODE"

NOAV_FILE="$HOME/.cache/opencode-jiepai/_not_image.txt"
echo "这不是图片" > "$NOAV_FILE"
NOAV=$(curl -s -X POST $BASE/user/avatar -H "Authorization: Bearer $CT" -F "file=@$NOAV_FILE;type=text/plain")
check "非图片类型 400" '"code":400' "$NOAV"

NOAUTH_AV=$(curl -s -X POST $BASE/user/avatar -F "file=@$AV_FILE;type=image/png")
check "头像上传未登录 401" '"code":401' "$NOAUTH_AV"

# 头像随 me 返回
ME=$(curl -s $BASE/auth/me -H "Authorization: Bearer $CT")
check "me 返回头像路径" '/uploads/avatar/' "$ME"

# --- 支付（mock 模式：PAY_MOCK=1，占位配置即可跑通） ---
# 1) 新下单默认未支付
P_ORD=$(curl -s -X POST $BASE/orders -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
  -d "{\"category_id\":$CID,\"title\":\"测试-支付流程\",\"address\":\"深圳市南山区支付路8号\",\"budget\":150}")
check "新订单默认待支付" '"pay_status":"unpaid"' "$P_ORD"
PID2=$(echo "$P_ORD" | j "d['data']['order']['id']")

# 2) 未支付不可退款
UNP_REF=$(curl -s -X POST $BASE/admin/orders/$PID2/refund -H "Authorization: Bearer $AT")
check "未支付退款 409" '无需退款' "$UNP_REF"

# 3) 发起支付（mock 直接成功）
PAY1=$(curl -s -X POST $BASE/pay/orders/$PID2 -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"code":""}')
check "支付成功 mock" '"mock":true' "$PAY1"
check "支付后 paid" '"pay_status":"paid"' "$PAY1"
TXN=$(echo "$PAY1" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['order']['transaction_id'])")
case "$TXN" in MOCK*) PASS=$((PASS+1)); echo "✅ 交易号 MOCK 前缀";; *) FAIL=$((FAIL+1)); echo "❌ 交易号=$TXN";; esac

# 4) 重复支付 409
PAY2=$(curl -s -X POST $BASE/pay/orders/$PID2 -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"code":""}')
check "重复支付 409" '"code":409' "$PAY2"

# 5) 支付状态查询（本人/他人/未登录）
PS=$(curl -s $BASE/pay/orders/$PID2 -H "Authorization: Bearer $CT")
check "支付状态查询" '"pay_status_text":"已支付"' "$PS"
PS403=$(curl -s $BASE/pay/orders/$PID2 -H "Authorization: Bearer $OT")
check "他人查支付状态 403" '"code":403' "$PS403"
PS401=$(curl -s $BASE/pay/orders/$PID2)
check "支付状态未登录 401" '"code":401' "$PS401"

# 6) 订单详情带支付字段
PD=$(curl -s $BASE/orders/$PID2 -H "Authorization: Bearer $CT")
check "详情含支付时间" '"paid_at":"' "$PD"

# 7) 管理端退款 + 重复退款
REF1=$(curl -s -X POST $BASE/admin/orders/$PID2/refund -H "Authorization: Bearer $AT")
check "退款成功" '"pay_status":"refunded"' "$REF1"
RFID=$(echo "$REF1" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['order']['refund_id'])")
case "$RFID" in MOCKRF*) PASS=$((PASS+1)); echo "✅ 退款单号 MOCKRF 前缀";; *) FAIL=$((FAIL+1)); echo "❌ 退款单号=$RFID";; esac
REF2=$(curl -s -X POST $BASE/admin/orders/$PID2/refund -H "Authorization: Bearer $AT")
check "重复退款 409" '"code":409' "$REF2"

# 8) 管理端列表带支付状态字段
ALIST=$(curl -s "$BASE/admin/orders?page=1" -H "Authorization: Bearer $AT")
check "管理端列表含 pay_status" '"pay_status"' "$ALIST"

# 9) 取消已支付订单 → mock 自动退款
C_ORD=$(curl -s -X POST $BASE/orders -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
  -d "{\"category_id\":$CID,\"title\":\"测试-支付后取消\",\"address\":\"深圳市南山区取消路2号\",\"budget\":88}")
CID2=$(echo "$C_ORD" | j "d['data']['order']['id']")
curl -s -X POST $BASE/pay/orders/$CID2 -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"code":""}' >/dev/null
CCANCEL=$(curl -s -X POST $BASE/orders/$CID2/cancel -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"reason":"临时有事"}')
check "支付后取消→自动退款" '"pay_status":"refunded"' "$CCANCEL"

# 10) 支付回调不走 JWT（匿名请求返回 400 FAIL 而非 401）
NOTIFY=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/pay/notify -H 'Content-Type: application/json' -d '{"foo":"bar"}')
if [ "$NOTIFY" = "400" ]; then PASS=$((PASS+1)); echo "✅ 匿名回调 400(FAIL 非 401)"; else FAIL=$((FAIL+1)); echo "❌ 匿名回调 HTTP=$NOTIFY 期望 400"; fi

# 11) 种子订单初始化为已支付（模拟线下已付）
SEED_PAID=$(curl -s "$BASE/admin/orders?page=1&status=completed" -H "Authorization: Bearer $AT")
check "已完成种子单已支付" '"pay_status":"paid"' "$SEED_PAID"

echo ""
echo "================ 结果：PASS=$PASS FAIL=$FAIL ================"
[ "$FAIL" -eq 0 ]
