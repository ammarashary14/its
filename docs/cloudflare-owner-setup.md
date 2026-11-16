# Connect the BTS owner dashboard to Cloudflare

On GitHub Pages and the private static preview, the dashboard is a local draft editor. The Cloudflare Worker supports persistent website content, a private application inbox, and owner actions after its database and sign-in configuration are connected. Adding these repository files does not provision or verify remote resources.

## Automatic setup

Follow [automatic Cloudflare setup](cloudflare-automatic-setup.md) for the current deployment workflow. In the `its` Worker’s Git build settings, use `npm run build` as the build command and `npm run deploy` as the deploy command. The scoped BTS build token needs the deployment permissions plus D1 Edit and the documented Access permissions.

The setup scripts verify account access, reuse or create only the `bts-site` database, apply all migrations, configure the BTS owner Access application, and deploy the Worker with `BTS_DB` and the returned identity settings. They stop on missing permissions or conflicting existing configuration. The generated runtime configuration is temporary, contains no credentials, and is removed when the command finishes. Continue using `npm run deploy` so subsequent builds retain the database and sign-in configuration.

A successful script run must be followed by the live checks below; local tests and a committed configuration do not establish that production setup succeeded.

## Manual setup alternative

1. Deploy the repository as Cloudflare Worker `its` using `npm run build` and `npx wrangler deploy`. The committed `wrangler.jsonc` serves `dist/` and sends API requests to `server/worker.js`. A Cloudflare Pages alternative uses `npm run build`, output `dist`, and the root `functions/` adapters.
2. Create or identify the dedicated D1 database `bts-site`. For a manual Worker deployment, keep a `d1_databases` entry in `wrangler.jsonc` with `binding: "BTS_DB"`, `database_name: "bts-site"`, the real `database_id`, and `migrations_dir: "migrations"`. Do not use a placeholder ID or a database belonging to another project.
3. After authenticating the scoped CLI, apply all repository migrations with `npx wrangler d1 migrations apply bts-site --remote`. This includes site content, applications and message settings, and application notification tracking. Do not seed real applicants or private profiles into migration files.
4. Configure Access and the owner runtime variables below, then redeploy. Set `BTS_APPLICATIONS_ENABLED=true` only after the database schema and owner inbox are ready. The separate Gmail sender connection is described below.
5. On the first content publication, the server saves revision 1. Public pages use `/api/content`; the signed-in dashboard uses `/api/owner/content`, which also includes hidden profiles. Local drafts stay on their current device until published or exported.

## Require owner sign-in

The exact owner allowlist is:

- `ammarashary@gmail.com`
- `breakingtheskyadmissions@gmail.com`

The automatic script creates or verifies a Cloudflare Zero Trust **Access self-hosted application** named **BTS owner dashboard**. For manual setup, put `breakingthesky.com/owner`, `breakingthesky.com/owner.html`, and `breakingthesky.com/api/owner/*` in the same application. Use email one-time PIN sign-in and one Allow policy containing exactly the two email addresses above. Keep public bypass rules off these paths. Ordinary website pages, `/api/content`, and application intake remain public.

Keep the Access cookie scoped to the hostname (`path_cookie_attribute: false`) so the owner page and API share the same signed session. Use that application’s audience and the account’s Access team domain in the Worker runtime configuration:

| Variable | Value or purpose |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | The actual Access team domain returned by Cloudflare, such as `your-team.cloudflareaccess.com`. |
| `CF_ACCESS_AUD` | The application’s exact audience (AUD) tag. The owner page and API use the same Access application. |
| `OWNER_EMAILS` | `ammarashary@gmail.com,breakingtheskyadmissions@gmail.com` |
| `OWNER_EMAIL` | `ammarashary@gmail.com`; legacy single-owner fallback, used for authorization only when `OWNER_EMAILS` is absent. |

Every owner API request validates the signature of `Cf-Access-Jwt-Assertion` against the team’s HTTPS signing keys, checks issuer, audience, expiry and subject, and checks the signed email against the owner allowlist. An explicitly configured `OWNER_EMAILS` list is authoritative; invalid or empty values fail closed rather than falling back to `OWNER_EMAIL`. An unsigned email header never grants access. Publishing and other private mutations also require same-origin JSON requests.

Use `https://breakingthesky.com/owner.html` for owner sign-in after setup. Any alternate hostname that should support editing needs its own matching Access coverage. Unsigned requests through a `workers.dev` or `pages.dev` address cannot use the private APIs. The static dashboard shell contains no password or private server records.

## Connect the admissions mailbox

The sender and notification mailbox is `breakingtheskyadmissions@gmail.com`. Follow [application review and email setup](application-review-setup.md) to enable Google 2-Step Verification and store a Google App Password in the Worker secret `GMAIL_APP_PASSWORD`. Do not use the regular account password, publish the App Password, or put it in the build configuration.

The runtime configuration uses `APPLICATION_EMAIL_PROVIDER=gmail` and `ADMISSIONS_EMAIL=breakingtheskyadmissions@gmail.com`. New application notifications go to that mailbox. Acceptance and rejection messages send from it to the email stored on the selected application. Owners write their messages in **Dashboard → Applications**, using `{{name}}`, `{{email}}`, and `{{reference}}`, then review the rendered email before sending. Saving a template does not send mail. Database setup does not establish Gmail delivery; verify both notification and decision sending with a controlled live test.

## Connect traffic stats

After the custom domain is a Cloudflare zone receiving proxied traffic, create an API token scoped to that zone with **Zone → Analytics → Read**. Set:

| Variable | Purpose |
| --- | --- |
| `CF_ZONE_ID` | The domain's 32-character zone ID. |
| `CF_ANALYTICS_API_TOKEN` | The scoped token, saved as a **secret** in the Worker environment. |

The token is used only inside the server. Never put it in `owner.html`, browser JavaScript, exported content, `.openai/hosting.json`, or a repository file.

The stats endpoint queries Cloudflare's GraphQL `httpRequests1dGroups` dataset for the last 7 or 30 complete UTC days. It returns total requests, page views, and bytes, plus daily rows. Cloudflare's `uniq.uniques` is labeled **unique IPs**, not verified people, and is not summed into an overall unique-visitor total. These are zone-level traffic figures: if the zone also serves unrelated sites or subdomains, their traffic is included. They do not measure volunteer applications or email delivery.

Data availability and retention depend on the Cloudflare zone plan and the dataset. A missing connection shows “not connected”; denied queries or unavailable data show an error instead of invented zeroes. Once authenticated, verify that the configured zone, period, and reported numbers match the Cloudflare dashboard before relying on them.

## Publishing and hidden profiles

Content is validated on both the client and the server. Updates are limited to 2 MiB and use an expected revision to prevent two tabs from silently overwriting each other. On a conflict, export the draft, reload the latest content, and reconcile the changes. Drafts created from filtered public content cannot publish over a complete owner version; reload the authenticated owner content and reapply those edits first. Export/import preserves revision metadata so a stale file cannot silently bypass the revision check. There is no server-side revision history or automatic rollback; export a backup before large edits.

The D1 record contains the complete profile list. `/api/content` removes profiles with `visible: false`; `/api/owner/content` requires verified owner identity and returns the complete list. Exported files contain hidden profiles too. When publishing a file manually to GitHub Pages, do not place hidden profiles in a public fallback JSON file: a hidden card is not private if its data is in a public asset.

Profile photos and optional profile/community contact details are published content. Application records and email templates are stored separately in private D1 tables and never belong in the public content configuration. When backend intake is enabled, applications are stored in the owner inbox and Gmail notification attempts are tracked separately from decision emails. The static-site FormSubmit fallback requires activation for the admissions mailbox and the relevant origin; a failed backend POST never automatically switches to that fallback. Existing FormSubmit history is not imported or forwarded automatically.

## Verification before enabling live edits

- Open the owner URL while signed out: Access must require sign-in.
- Confirm each of the two allowed owner addresses can sign in, a third address cannot publish, and direct unsigned API requests fail.
- Submit a labeled test application and confirm it appears only in the private inbox. After Gmail is connected, verify its notification and an owner-reviewed decision email.
- Publish a small edit and confirm it appears in a new public browser session.
- Hide a test profile and verify its name, bio, and photo are absent from `/api/content`, while the owner dashboard retains it.
- Open two owner tabs and confirm the second stale publication reports a conflict.
- Confirm analytics numbers come from the selected zone, with no fake sample rows.

Local server checks run with `node --test tests/cloudflare-owner.test.mjs`; they use signed test JWTs, fake storage, and mocked provider responses. They verify authorization and API behavior, but do not establish that your production Access policy, D1 binding, or analytics token has been configured.

References: [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [GraphQL Analytics](https://developers.cloudflare.com/analytics/graphql-api/), [zone analytics metrics](https://developers.cloudflare.com/analytics/graphql-api/migration-guides/zone-analytics/).
