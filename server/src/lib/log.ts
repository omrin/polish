/** One JSON line per request. Never pass user text, emails, IPs, codes or tokens here. */
export function logEvent(fields: Record<string, string | number | boolean | null | undefined>) {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...fields }));
}
