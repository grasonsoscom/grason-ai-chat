// Seed data for local development. All people, phone numbers and emails here
// are fictitious (+62 800... range, *.test domains).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// On Vercel the app is public: no known default passwords there.
const ON_VERCEL = Boolean(process.env.VERCEL);

// Local test login (change via SEED_ADMIN_PASSWORD; required on Vercel).
const ADMIN_EMAIL = "admin@centris.test";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? (ON_VERCEL ? "" : "centris-dev-123");

// Demo login with full (Admin) access for trying the app locally.
const DEMO_EMAIL = "demo@centris.test";
const DEMO_PASSWORD = "demo-centris-2026";

/** Creates or resets the demo account. Safe to run on an existing database. */
async function ensureDemoUser() {
  if (ON_VERCEL) return;
  const role = await db.role.findUnique({ where: { name: "Admin" } });
  if (!role) return;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await db.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash, status: "active", roleId: role.id },
    create: { name: "Akun Demo", email: DEMO_EMAIL, passwordHash, roleId: role.id },
  });
  console.log(`Demo account ready: ${DEMO_EMAIL} (password in prisma/seed.ts)`);
}

/**
 * Login is by WhatsApp QR, matched on the staff phone number. Set
 * SEED_ADMIN_PHONE to your own WhatsApp number so you can sign in as admin.
 */
async function ensureAdminPhone() {
  const phone = process.env.SEED_ADMIN_PHONE?.trim();
  if (!phone) return console.log("SEED_ADMIN_PHONE not set: no account can log in by WhatsApp QR yet.");
  await db.user.update({ where: { email: ADMIN_EMAIL }, data: { phone } });
  console.log("Admin WhatsApp number set from SEED_ADMIN_PHONE.");
}

async function main() {
  if (await db.account.findUnique({ where: { id: 1 } })) {
    console.log("Database already seeded, skipping sample data.");
    await ensureDemoUser();
    await ensureAdminPhone();
    return;
  }
  if (!ADMIN_PASSWORD) throw new Error("Set SEED_ADMIN_PASSWORD in the Vercel environment variables before the first deploy.");

  await db.account.create({ data: { id: 1, name: "Vivagoat", coins: 89103 } });

  const admin = await db.role.create({
    data: { name: "Admin", description: "Akses penuh ke semua modul", permissions: "all" },
  });
  const cs = await db.role.create({
    data: { name: "Staf CS", description: "Membalas pesan dan menangani eskalasi", permissions: "pesan,pelanggan,kalender" },
  });
  await db.role.create({
    data: { name: "Marketing", description: "Mengelola audience dan broadcast", permissions: "broadcast,audience,pelanggan" },
  });
  const group = await db.group.create({ data: { name: "Tim CS" } });

  const owner = await db.user.create({
    data: {
      name: "Admin Centris", email: ADMIN_EMAIL, phone: "+6280000000001",
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10), roleId: admin.id, groupId: group.id,
    },
  });
  const staff = await db.user.create({
    data: {
      name: "Staf Satu", email: "staf1@centris.test", phone: "+6280000000002",
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10), roleId: cs.id, groupId: group.id,
    },
  });

  const device = await db.device.create({
    data: {
      label: "CS Vivagoat", phone: "+6280000001000", coex: true,
      connectedAt: new Date(Date.now() - 6 * 86400 * 1000),
      staff: { connect: [{ id: owner.id }, { id: staff.id }] },
      events: { create: [{ message: "Perangkat terhubung ke Cloud API" }] },
      templates: {
        create: [
          { name: "sapaan_ulang", category: "MARKETING", body: "Halo kak, masih tertarik dengan Vivagoat? Balas pesan ini ya." },
        ],
      },
    },
  });

  const product = await db.product.create({
    data: {
      name: "Vivagoat Susu Kambing Bubuk",
      description: "Susu kambing bubuk dengan madu dan rempah. Terdaftar BPOM dan bersertifikat halal.",
      aiPrompt: "Sajikan 1 sachet dengan 150 ml air hangat, 1-2 kali sehari.",
      variants: { create: [{ name: "1 Box (10 sachet)", price: 125000 }, { name: "3 Box", price: 340000 }] },
    },
  });

  const funnel = await db.funnel.create({ data: { name: "Alur Penjualan Utama" } });
  const l1 = await db.funnelLevel.create({ data: { funnelId: funnel.id, order: 1 } });
  const l2 = await db.funnelLevel.create({ data: { funnelId: funnel.id, order: 2 } });
  const lead = await db.funnelStage.create({
    data: { levelId: l1.id, order: 1, number: 1, name: "Lead", description: "First time customer has a conversation and has not asked about products yet." },
  });
  await db.funnelStage.create({
    data: { levelId: l2.id, order: 1, number: 2, name: "Product Inquiry", description: "The customer asks about products, product benefits, or pricing." },
  });

  await db.label.createMany({ data: [{ name: "Prospek", color: "#3b82f6" }, { name: "Pelanggan Setia", color: "#22c55e" }] });

  await db.aiAgent.create({
    data: {
      name: "Cs Vivagoat 2",
      description: "gunakan bahasa yg santai, jangan terlihat baku/kaku, dan jangan pernah mengaku kalau kamu adalah ai",
      baseLearning: "Customer Service",
      funnelId: funnel.id,
      products: { connect: [{ id: product.id }] },
      devices: { connect: [{ id: device.id }] },
    },
  });

  const samples = [
    { name: "Pelanggan A", phone: "+6280000002001", msgs: ["Halo kak, ini susu kambingnya ada BPOM?"] },
    { name: "Pelanggan B", phone: "+6280000002002", msgs: ["Harga 3 box berapa ya?", "Bisa COD?"] },
    { name: "Pelanggan C", phone: "+6280000002003", msgs: ["Mau komplain, paket belum sampai"] },
  ];
  for (const [i, s] of samples.entries()) {
    const c = await db.customer.create({ data: { name: s.name, phone: s.phone, stageId: lead.id } });
    const at = new Date(Date.now() - (i + 1) * 40 * 60 * 1000);
    const conv = await db.conversation.create({
      data: {
        customerId: c.id, deviceId: device.id, unread: s.msgs.length, lastMessageAt: at, lastInboundAt: at,
        mode: i === 2 ? "eskalasi" : i === 1 ? "staf" : "ai", assignedToId: i === 1 ? staff.id : null,
      },
    });
    for (const text of s.msgs) {
      await db.message.create({ data: { conversationId: conv.id, direction: "in", sender: "customer", text, status: "read", createdAt: at } });
    }
  }

  console.log(`Seeded. Login: ${ADMIN_EMAIL} (password in prisma/seed.ts or SEED_ADMIN_PASSWORD)`);
  await ensureDemoUser();
  await ensureAdminPhone();
}

main().finally(() => db.$disconnect());
