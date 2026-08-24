import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, salt, value] = stored.split(":");
  if (kind !== "scrypt" || !salt || !value) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(value, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const sessionToken = () => randomBytes(32).toString("base64url");
export const temporaryPassword = "SteelCool123";
