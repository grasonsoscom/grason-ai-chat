import { db } from "./db";

// [TBD] Coin pricing is an open product question (PRD 7.1). Costs come from
// env and default to 0 until decided; the balance check runs whenever cost > 0.
export const COIN_COSTS = {
  aiReply: Number(process.env.COIN_COST_AI_REPLY ?? 0),
  broadcastMessage: Number(process.env.COIN_COST_BROADCAST_MESSAGE ?? 0),
};

export class InsufficientCoinsError extends Error {
  constructor(public needed: number, public balance: number) {
    super(
      `Saldo koin tidak cukup. Dibutuhkan ${needed.toLocaleString("id-ID")} koin, ` +
        `saldo Anda ${balance.toLocaleString("id-ID")} koin. Silakan Isi Ulang.`,
    );
  }
}

export async function getBalance() {
  const acc = await db.account.findUnique({ where: { id: 1 } });
  return acc?.coins ?? 0;
}

/** Throws InsufficientCoinsError before any work happens if balance is too low. */
export async function assertCoins(amount: number) {
  if (amount <= 0) return;
  const balance = await getBalance();
  if (balance < amount) throw new InsufficientCoinsError(amount, balance);
}

/** Atomically deducts coins; fails (instead of going negative) if balance changed meanwhile. */
export async function spendCoins(amount: number, reason: string) {
  if (amount <= 0) return;
  const res = await db.account.updateMany({
    where: { id: 1, coins: { gte: amount } },
    data: { coins: { decrement: amount } },
  });
  if (res.count === 0) throw new InsufficientCoinsError(amount, await getBalance());
  await db.coinTransaction.create({ data: { amount: -amount, reason } });
}
