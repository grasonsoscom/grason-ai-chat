#!/bin/bash
set -euo pipefail

SECRET=$(grep '^INCOMING_WEBHOOK_SECRET=' /opt/grason-ai-chat/.env | cut -d= -f2- | tr -d '"')

echo "== inbound =="
curl -sS -m 60 -X POST \
  -H "x-webhook-secret: $SECRET" \
  -H "content-type: application/json" \
  -d '{"phone":"+6281299990002","name":"V2 Checkout","text":"Saya mau order Bio Serea 2"}' \
  http://127.0.0.1:3000/api/webhooks/incoming
echo

echo "== cron =="
/usr/local/bin/grason-oms-cron
sleep 2

echo "== leads =="
docker compose -f /opt/grason-oms/docker-compose.yml exec -T postgres \
  psql -U grason -d grason_oms -P pager=off -c \
  "SELECT external_id, segmen, status FROM leads ORDER BY created_at DESC LIMIT 3;"
