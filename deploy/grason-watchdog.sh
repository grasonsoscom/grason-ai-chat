#!/bin/sh
# VPS watchdog (cron, every 2 minutes): checks the chat app and the OMS API.
# Two failed checks in a row -> pm2 restart; once the chat app answers again,
# the admin gets a WhatsApp alert through POST /api/cron/alert.
# Install: /usr/local/bin/grason-watchdog + /etc/cron.d/grason-watchdog.
set -u
STATE=/var/lib/grason-watchdog
mkdir -p "$STATE"
SECRET=$(grep -E '^INCOMING_WEBHOOK_SECRET=' /opt/grason-ai-chat/.env | cut -d= -f2- | tr -d '"')

alert() {
  curl -s -m 20 -X POST -H "x-webhook-secret: $SECRET" -H "Content-Type: application/json" \
    -d "{\"key\":\"$1\",\"text\":\"$2\"}" http://127.0.0.1:3000/api/cron/alert >/dev/null || true
}

# check NAME URL OK_CODES PM2_APP
check() {
  code=$(curl -s -o /dev/null -m 15 -w "%{http_code}" "$2" || echo 000)
  case " $3 " in
    *" $code "*)
      if [ -f "$STATE/$1.restarted" ]; then
        rm -f "$STATE/$1.restarted" "$STATE/$1.fail"
        alert "$1" "$1 sempat tidak merespons dan sudah di-restart otomatis oleh watchdog. Sekarang normal."
      fi
      rm -f "$STATE/$1.fail"
      ;;
    *)
      if [ -f "$STATE/$1.fail" ]; then
        logger -t grason-watchdog "$1 down (HTTP $code), restarting $4"
        pm2 restart "$4" >/dev/null 2>&1
        touch "$STATE/$1.restarted"
        rm -f "$STATE/$1.fail"
      else
        touch "$STATE/$1.fail"
      fi
      ;;
  esac
}

check grason-chat http://127.0.0.1:3000/login "200" grason-chat
# OMS API answers 401 without an API key: that still means it is up.
check oms-api http://127.0.0.1:3001/api/v3/prices "200 401" oms-api
