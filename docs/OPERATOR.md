# Running the Polish service

This guide is for the person who runs Polish as a paid service: you hold one Anthropic API key, and your users sign in and buy credits. Follow the steps in order. Most are one-time.

Throughout, **`<DOMAIN>`** means your domain, for example `getpolish.app`.

**What it costs you:** a domain (about $10 a year), Cloudflare Workers Paid ($5 a month), Anthropic usage, and Paddle's fee per sale (about 5% + $0.50). Resend and Google sign-in are free at launch volumes.

---

## 1. Domain and Cloudflare

1. Create a Cloudflare account at https://dash.cloudflare.com.
2. Buy your domain under **Domain Registration → Register Domains**. Buying it from Cloudflare keeps all the DNS records in one place.
3. Upgrade to **Workers Paid** under **Workers & Pages → Plans**.
4. Create the database. In **Storage & Databases → D1 → Create**, name it `polish-db`, then copy its **Database ID**.
5. Create an API token under **My Profile → API Tokens → Create Token**:
   - Use the **Edit Cloudflare Workers** template.
   - Add the permission **Account → D1 → Edit**.
   - Copy the token.
6. Copy your **Account ID**. It's in the right-hand column of the Workers overview page.

## 2. Anthropic

1. In the Anthropic Console (https://console.anthropic.com), create a workspace called **Polish production**.
2. Set a **monthly spend limit** on that workspace.
3. Create an API key in that workspace.
4. Read Anthropic's Commercial Terms and Usage Policy, and sign the Data Processing Addendum if you need it.

The service also stops itself for the day when Anthropic costs reach `MAX_DAILY_RAW_COST_USD` (default $50). You can change it in `server/wrangler.toml`.

## 3. Sign-in emails (Resend)

1. Create an account at https://resend.com.
2. Add `<DOMAIN>` under **Domains** and copy the DNS records it shows (DKIM, SPF, DMARC) into Cloudflare DNS. Wait for **Verified**.
3. Create an API key.

## 4. Google sign-in (optional)

1. In Google Cloud Console (https://console.cloud.google.com), create a project.
2. Set up the **OAuth consent screen**:
   - User type: External.
   - Scopes: `openid` and `email` only.
   - Add the links to your Privacy and Terms pages, then publish it.
3. Create an OAuth client under **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized redirect URI: `https://<DOMAIN>/auth/google/callback`
4. Copy the **Client ID** and the **Client secret**.

To skip Google sign-in, leave `GOOGLE_CLIENT_ID` empty. People can still sign in with an emailed code.

## 5. Paddle (payments)

Start in the **sandbox** (https://sandbox-vendors.paddle.com). Switch to live once everything works and Paddle has approved your account.

1. Go to **Catalog → Products → New product**. Name it "Polish credits", with tax category **Standard digital goods**.
2. Add three **one-time** prices to that product: **$5**, **$10** and **$25**. Copy each price ID (`pri_…`).
3. Go to **Developer tools → Authentication** and create a **client-side token**.
4. Go to **Developer tools → Notifications → New destination**:
   - URL: `https://<DOMAIN>/webhooks/paddle`
   - Events: `transaction.completed` and `adjustment.updated`
   - Copy the **secret key** it shows.
5. Before going live, complete Paddle's business verification and submit `<DOMAIN>` for website approval. Paddle checks the Terms, Privacy and Refund pages, so finish step 7 first.

## 6. Fill in the settings

Edit the `[vars]` section of **`server/wrangler.toml`** and commit the change:

| Setting | Value |
|---|---|
| `DOMAIN` | `<DOMAIN>` (no `https://`) |
| `GOOGLE_CLIENT_ID` | from step 4, or empty |
| `PADDLE_ENV` | `sandbox`, or `production` once live |
| `PADDLE_CLIENT_TOKEN` | from step 5.3 |
| `PADDLE_PRICE_SMALL` / `_PLUS` / `_PRO` | the $5 / $10 / $25 price IDs |
| `RESEND_FROM` | `Polish <sign-in@<DOMAIN>>` |
| `ADMIN_EMAILS` | your email, so you can use the admin routes |
| `EXTENSION_IDS` | already set for the extension in this repo; add the Chrome Web Store ID if you publish there |

Then, in GitHub, open **Settings → Secrets and variables → Actions**.

**Variables** tab:

| Name | Value |
|---|---|
| `D1_DATABASE_ID` | from step 1.4 |
| `CLOUDFLARE_DEPLOY` | `true`. This switches automatic deployment on. |

**Secrets** tab:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | from step 1.5 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 1.6 |
| `ANTHROPIC_API_KEY` | from step 2 |
| `RESEND_API_KEY` | from step 3 |
| `GOOGLE_CLIENT_SECRET` | from step 4 (optional) |
| `PADDLE_WEBHOOK_SECRET` | from step 5.4 |
| `SESSION_SECRET`, `CODE_PEPPER`, `RATE_SALT` | three different long random strings. Generate each one with `openssl rand -hex 32`, or with a password manager. Never change `SESSION_SECRET` later, or everyone is signed out. |

## 7. Legal pages

Open `website/public/terms.html`, `privacy.html` and `refunds.html`.

1. Replace every `[bracketed]` item, such as your legal name, address, support email and governing law.
2. Have a lawyer review the pages. Users may send medical text, and the service runs under Israeli privacy law (including Amendment 13).
3. Remove the yellow **Draft** box from each page.

## 8. Deploy

1. Commit and push. The **Polish service** workflow (Actions tab) tests the server, deploys it, applies the database migrations and uploads the secrets.
2. In Cloudflare, go to **Workers & Pages → polish → Settings → Domains & Routes → Add → Custom domain** and enter `<DOMAIN>`.
3. Check `https://<DOMAIN>`. You should see the landing page.

## 9. Point the apps at your domain

1. In `shared/prompt.json`, replace `polish.example.com` with `<DOMAIN>` in the `service` section.
2. Run `python3 scripts/sync_shared.py`.
3. Bump the number in `VERSION` (for example to `1.1.0`), then commit and push. A new release is built with apps that sign in to your service.

## 10. Smoke test (sandbox)

1. Go to `https://<DOMAIN>/signin`, sign in with an email code, and check that you have 75 credits.
2. Install the desktop app. Click **Sign in**, approve in the browser, then check a sentence. The balance should go down by a few credits.
3. In the extension's Options, click **Sign in to Polish**, approve, and check a text box.
4. On the Account page, buy the $5 pack using a Paddle sandbox test card. About 500 credits should appear within a minute.
5. Refund that purchase in Paddle. The 500 credits should be removed.
6. If all of that works, switch `PADDLE_ENV` to `production`, put the live Paddle values in `wrangler.toml` and the GitHub secrets, then push.

## Day to day

- **Logs:** Cloudflare → Workers & Pages → polish → Logs. Logs contain metadata only (no user text) and are kept for 7 days.
- **Give credits or block a user:** sign in on the website with an `ADMIN_EMAILS` address, then:
  - look up a user: `GET /admin/users?email=…`
  - add or remove credits: `POST /admin/users/<id>/grant {"credits": 100, "note": "support"}`
  - block or unblock: `POST /admin/users/<id>/disable` and `/enable`
- **Daily usage and cost:** `GET /admin/stats`.
- **Change the AI model:** set `DEFAULT_MODEL` or `FAST_MODEL` in `wrangler.toml`. No app release is needed.
- **Change prices:** update the pack sizes in `server/src/lib/pricing.ts` and the prices in Paddle together.
