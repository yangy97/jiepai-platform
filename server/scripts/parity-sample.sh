#!/bin/bash
# parity 抽查采样（迁移前后同参数重采，存 prefix_orders*.json / prefix_detail.json / prefix_stats.json）
# 用法：bash scripts/parity-sample.sh /tmp/before2
set -e
PFX="${1:-/tmp/sample}"
BASE=http://127.0.0.1:7010/api
ADMIN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"phone":"13900000000","password":"admin123"}')
AT=$(echo "$ADMIN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")

curl -s "$BASE/admin/orders?page=1&size=20" -H "Authorization: Bearer $AT" > "${PFX}_orders.json"
curl -s "$BASE/admin/orders?page=1&size=20&keyword=%E4%BF%9D%E6%B4%81" -H "Authorization: Bearer $AT" > "${PFX}_orders_kw_title.json"
curl -s "$BASE/admin/orders?page=1&size=20&keyword=138" -H "Authorization: Bearer $AT" > "${PFX}_orders_kw_phone.json"
OID=$(python3 -c "import json;print(json.load(open('${PFX}_orders.json'))['data']['list'][0]['id'])")
curl -s "$BASE/admin/orders/$OID" -H "Authorization: Bearer $AT" > "${PFX}_detail.json"
curl -s "$BASE/admin/dashboard" -H "Authorization: Bearer $AT" > "${PFX}_stats.json"
echo "sampled id=$OID -> ${PFX}_*.json"
