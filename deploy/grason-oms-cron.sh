#!/bin/sh
# Drains the grason-ai-chat OMS outbox and polls open orders.
SECRET=$(grep '^INCOMING_WEBHOOK_SECRET=' /opt/grason-ai-chat/.env | cut -d= -f2- | tr -d '"')
curl -s -X POST -H "x-webhook-secret: $SECRET" http://127.0.0.1:3000/api/cron/oms >/dev/null 2>&1
