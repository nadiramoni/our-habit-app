import { createHash } from "crypto";
import { db } from "@/lib/db";

export function hashPin(pin: string, username: string): string {
  return createHash("sha256").update(`${pin}::${username.toLowerCase()}`).digest("hex");
}

export function cleanUsername(u: string): string {
  return u.trim().toLowerCase();
}

export function validUsername(u: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(u);
}

export function validPin(p: string): boolean {
  return /^\d{4}$/.test(p);
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function makeInviteCode(): string {
  let c = "";
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export async function authUser(username: string, pin: string) {
  const uname = cleanUsername(username);
  const user = await db.user.findUnique({ where: { username: uname } });
  if (!user) return null;
  if (user.pinHash !== hashPin(pin, uname)) return null;
  return user;
}

export function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join("|");
}
