#!/bin/bash
set -euo pipefail

KEY=$(cat /root/grason-oms-api-key)
BASE=http://127.0.0.1:3001/api/v1
LEAD_ID=$(docker compose -f /opt/grason-oms/docker-compose.yml exec -T postgres \
  psql -U grason -d grason_oms -tAc \
  "SELECT id FROM leads WHERE external_id='conv_4' ORDER BY created_at DESC LIMIT 1")
EXT="staging_order_$(date +%s)"

RESP=$(curl -sS -X POST \
  -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  -d "{\"external_id\":\"$EXT\",\"lead_id\":\"$LEAD_ID\",\"metode_bayar\":\"cod\",\"penerima\":{\"nama\":\"Staging OMS\",\"no_wa\":\"081299990001\"},\"alamat\":{\"alamat\":\"Jl. Test No. 1\",\"kota\":\"Bandung\",\"provinsi\":\"Jawa Barat\"},\"items\":[{\"sku\":\"BSR-01\",\"qty\":1}],\"ongkir\":15000,\"diskon\":0}" \
  "$BASE/orders")

echo "$RESP" | jq '{order_group_id, external_id, orders: [.orders[] | {id, nomor, status, entitas, total, nilai_cod}]}'

ORDER_ID=$(echo "$RESP" | jq -r '.orders[0].id')
COD=$(echo "$RESP" | jq -r '.orders[0].nilai_cod')

VER=$(curl -sS -X POST \
  -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  -d "{\"dikonfirmasi_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"nilai_cod_dikonfirmasi\":$COD,\"catatan\":\"Staging test\"}" \
  "$BASE/orders/$ORDER_ID/verifikasi")

echo "$VER" | jq '{id, nomor, status, total, nilai_cod, terverifikasi_at}'
