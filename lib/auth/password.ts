import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

// Argon2id is the default algorithm; explicitly set numeric value to avoid
// const-enum restriction with isolatedModules (Algorithm.Argon2id = 2).
const OPTIONS = {
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
  algorithm: 2,
} as const;

export async function hash(password: string): Promise<string> {
  return argonHash(password, OPTIONS);
}

export async function verify(hashed: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashed, password, OPTIONS);
  } catch {
    return false;
  }
}
