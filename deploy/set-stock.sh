#!/bin/bash
set -euo pipefail

cd /opt/grason-oms
if [ ! -f /root/grason-ethix-api-key ]; then
  OUT=$(pnpm --filter @grason/api apikey:create --sistem ethix --nama "Staging Ethix" 2>&1)
  KEY=$(printf '%s\n' "$OUT" | grep -E '^gok_[0-9a-f]{12}_[A-Za-z0-9_-]+' | tail -1 || true)
  if [ -z "$KEY" ]; then
    echo "ETHIX KEY FAILED"
    printf '%s\n' "$OUT" | tail -20
    exit 1
  fi
  printf '%s' "$KEY" > /root/grason-ethix-api-key
  chmod 600 /root/grason-ethix-api-key
fi

KEY=$(cat /root/grason-ethix-api-key)
SNAPSHOT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BODY=$(jq -n --arg t "$SNAPSHOT" '{
  snapshot_at: $t,
  items: [
    {sku: "BSR-01", stok_layak_jual: 100},
    {sku: "KKT-01", stok_layak_jual: 100},
    {sku: "VVG-01", stok_layak_jual: 100},
    {sku: "WUP-01", stok_layak_jual: 100}
  ]
}')

echo "== POST /api/ethix/stock =="
curl -sS -w "\nHTTP:%{http_code}\n" -X POST \
  -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  -d "$BODY" \
  http://127.0.0.1:3001/api/v1/ethix/stock

echo "== GET /api/v1/stock (CS AI key) =="
CSKEY=$(cat /root/grason-oms-api-key)
curl -sS -H "Authorization: Bearer $CSKEY" http://127.0.0.1:3001/api/v1/stock | jq '.data[] | {sku, tersedia}'
