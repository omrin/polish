const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org", "tempmail.com", "yopmail.com",
  "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com",
  "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempail.com", "moakt.com",
]);

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

export const isEmail = (s: string) => EMAIL.test(s.trim());

/** Lowercase, trim, drop +tags; Gmail also ignores dots. Used only for identity and starter-credit dedupe. */
export function normalizeEmail(raw: string): string {
  const e = raw.trim().toLowerCase();
  let [local, domain] = e.split("@");
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export const isDisposable = (email: string) => DISPOSABLE.has(email.split("@")[1] || "");
