#!/bin/bash
set -euo pipefail

ADMIN_ID=$(docker compose -f /opt/grason-oms/docker-compose.yml exec -T postgres \
  psql -U grason -d grason_chat -tAc "SELECT id FROM \"User\" WHERE email='admin@centris.test'")
AUTH=$(grep '^AUTH_SECRET=' /opt/grason-ai-chat/.env | cut -d= -f2- | tr -d '"')

COOKIE=$(cd /opt/grason-ai-chat && AUTH_SECRET="$AUTH" ADMIN_ID="$ADMIN_ID" node --input-type=module -e '
import { SignJWT } from "jose";
const token = await new SignJWT({ uid: Number(process.env.ADMIN_ID) })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
console.log(token);
')

echo "admin_id=$ADMIN_ID"
echo "== chat -> oms catalog =="
curl -sS -m 30 -H "Cookie: centris_session=$COOKIE" http://127.0.0.1:3000/api/oms/catalog | head -c 700
echo
echo "== lead model =="
grep -n -A12 'model Lead' /opt/grason-oms/packages/db/prisma/schema.prisma | head -20
echo "== db tables =="
docker compose -f /opt/grason-oms/docker-compose.yml exec -T postgres \
  psql -U grason -d grason_oms -tAc "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1" | head -30
