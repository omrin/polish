const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: sortable by time, 26 chars. */
export function ulid(now = Date.now()): string {
  let t = now, time = "";
  for (let i = 0; i < 10; i++) { time = ALPHA[t % 32] + time; t = Math.floor(t / 32); }
  const r = crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHA[r[i] % 32];
  return time + rand;
}

export const nowSec = () => Math.floor(Date.now() / 1000);
