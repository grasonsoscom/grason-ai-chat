#!/bin/bash
set -euo pipefail

KEY=$(cat /root/grason-oms-api-key)
BASE=http://127.0.0.1:3001/api/v1

echo "== leads =="
docker compose -f /opt/grason-oms/docker-compose.yml exec -T postgres \
  psql -U grason -d grason_oms -P pager=off -c \
  "SELECT id, external_id, status, agen, sumber FROM leads ORDER BY created_at DESC LIMIT 3;"

LEAD_ID=$(docker compose -f /opt/grason-oms/docker-compose.yml exec -T postgres \
  psql -U grason -d grason_oms -tAc \
  "SELECT id FROM leads WHERE external_id='conv_4' ORDER BY created_at DESC LIMIT 1")
echo "lead_id=$LEAD_ID"

EXT="staging_order_$(date +%s)"
echo "== POST /orders =="
curl -sS -w "\nHTTP:%{http_code}\n" -X POST \
  -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  -d "{\"external_id\":\"$EXT\",\"lead_id\":\"$LEAD_ID\",\"metode_bayar\":\"cod\",\"penerima\":{\"nama\":\"Staging OMS\",\"no_wa\":\"081299990001\"},\"alamat\":{\"alamat\":\"Jl. Test No. 1\",\"kota\":\"Bandung\",\"provinsi\":\"Jawa Barat\"},\"items\":[{\"sku\":\"BSR-01\",\"qty\":1}],\"ongkir\":15000,\"diskon\":0}" \
  "$BASE/orders"

echo "== OMS API log =="
pm2 logs oms-api --lines 25 --nostream 2>&1 | tail -35
