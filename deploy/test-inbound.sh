#!/bin/bash
set -euo pipefail

SECRET=$(grep '^INCOMING_WEBHOOK_SECRET=' /opt/grason-ai-chat/.env | cut -d= -f2- | tr -d '"')

echo "== inbound =="
curl -sS -m 60 -X POST \
  -H "x-webhook-secret: $SECRET" \
  -H "content-type: application/json" \
  -d '{"phone":"+6281299990001","name":"Staging OMS","text":"Halo, saya mau tanya stok Bio Serea"}' \
  http://127.0.0.1:3000/api/webhooks/incoming
echo

echo "== cron =="
/usr/local/bin/grason-oms-cron
sleep 2

echo "== leads =="
docker compose -f /opt/grason-oms/docker-compose.yml exec -T postgres \
  psql -U grason -d grason_oms -P pager=off -c \
  "SELECT l.id, l.external_id, l.status, l.created_at, c.no_wa, c.nama
   FROM leads l JOIN customers c ON c.id = l.customer_id
   ORDER BY l.created_at DESC LIMIT 3;"
