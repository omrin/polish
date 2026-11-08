import type { Env } from "../env";

export async function sendCode(env: Env, to: string, code: string): Promise<void> {
  const base = env.RESEND_BASE_URL || "https://api.resend.com";
  const text = `Your Polish sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#0f1420">
    <p>Your Polish sign-in code:</p>
    <p style="font-size:30px;letter-spacing:6px;font-weight:600;margin:12px 0">${code}</p>
    <p style="color:#586274">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`;
  const r = await globalThis.fetch(`${base}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.RESEND_FROM, to: [to], subject: `Your Polish sign-in code: ${code}`, text, html }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}`);
}
