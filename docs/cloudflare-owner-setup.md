# Connect the BTS owner dashboard to Cloudflare

The dashboard currently works as a local draft editor on GitHub Pages and the private static preview. This repository includes a real Cloudflare Pages Functions backend; GitHub Pages does not execute it. No Cloudflare account, database, access policy, or analytics connection is created by adding these files.

## Deploy the existing site

1. Connect this repository to Cloudflare Pages. Use `npm run build` and output directory `dist`. Keep the `functions/` and `server/` directories in the repository: Pages builds Functions from the project root alongside the static output.
2. Create a D1 database and bind it to the Pages project as **`BTS_DB`**, for the intended production environment. Apply the schema in `migrations/0001_owner_content.sql` before enabling publication. For example, after authenticating your own Wrangler CLI, run `npx wrangler d1 execute <database-name> --remote --file=migrations/0001_owner_content.sql`. Do not seed real profiles into migration files.
3. Configure owner identity before enabling the dashboard's publishing controls, as described below. Re-deploy after changing bindings or variables.
4. On the first publication, the server saves the validated content at revision 1. Public pages fetch `/api/content`; the owner dashboard fetches `/api/owner/content`, which additionally includes hidden staff profiles. Local drafts remain on the current device until published or exported.

## Require owner sign-in

Create a Cloudflare Zero Trust **Access self-hosted application** for the site. In the same application, cover both `/owner.html` and `/api/owner/*` on the production hostname. Add an Allow policy limited to **ammarashary@gmail.com**, using an identity provider or Cloudflare's email one-time PIN. Do not add a public bypass policy for these paths. Leave ordinary website pages and `/api/content` public.

Use the application's audience value and your Access team domain in the Pages runtime environment:

| Variable | Purpose |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | The Access team domain, such as `your-team.cloudflareaccess.com`. The `https://` prefix is optional. |
| `CF_ACCESS_AUD` | The exact application audience (AUD) tag. The owner page and API must use the same Access application. |
| `OWNER_EMAIL` | The sole authorized owner email, `ammarashary@gmail.com`. |

Every owner API request verifies the signature of `Cf-Access-Jwt-Assertion` against the team's HTTPS JWKS endpoint, checks issuer, audience, expiry, and subject, then checks the signed email against `OWNER_EMAIL`. An unsigned email header is never enough. Missing configuration fails closed. The server additionally requires a same-origin JSON POST for publishing, so a cross-origin form cannot change the site.

Protect every alternate hostname that will allow editing. A `pages.dev` preview with no Access application cannot publish, because the API will reject missing signed identity. The static dashboard itself contains no password, token, or private server data; hiding its URL is not access control.

## Connect traffic stats

After the custom domain is a Cloudflare zone receiving proxied traffic, create an API token scoped to that zone with **Zone → Analytics → Read**. Set:

| Variable | Purpose |
| --- | --- |
| `CF_ZONE_ID` | The domain's 32-character zone ID. |
| `CF_ANALYTICS_API_TOKEN` | The scoped token, saved as a **secret** in the Pages environment. |

The token is used only inside the server. Never put it in `owner.html`, browser JavaScript, exported content, `.openai/hosting.json`, or a repository file.

The stats endpoint queries Cloudflare's GraphQL `httpRequests1dGroups` dataset for the last 7 or 30 complete UTC days. It returns total requests, page views, and bytes, plus daily rows. Cloudflare's `uniq.uniques` is labeled **unique IPs**, not verified people, and is not summed into an overall unique-visitor total. These are zone-level traffic figures: if the zone also serves unrelated sites or subdomains, their traffic is included. They do not measure volunteer applications or email delivery.

Data availability and retention depend on the Cloudflare zone plan and the dataset. A missing connection shows “not connected”; denied queries or unavailable data show an error instead of invented zeroes. Once authenticated, verify that the configured zone, period, and reported numbers match the Cloudflare dashboard before relying on them.

## Publishing and hidden profiles

Content is validated on both the client and the server. Updates are limited to 2 MiB and use an expected revision to prevent two tabs from silently overwriting each other. On a conflict, export the draft, reload the latest content, and reconcile the changes. Drafts created from filtered public content cannot publish over a complete owner version; reload the authenticated owner content and reapply those edits first. Export/import preserves revision metadata so a stale file cannot silently bypass the revision check. There is no server-side revision history or automatic rollback; export a backup before large edits.

The D1 record contains the complete profile list. `/api/content` removes profiles with `visible: false`; `/api/owner/content` requires verified owner identity and returns the complete list. Exported files contain hidden profiles too. When publishing a file manually to GitHub Pages, do not place hidden profiles in a public fallback JSON file: a hidden card is not private if its data is in a public asset.

Profile photos and optional profile/community contact details are published content. Use appropriately sized photos you intend to make public; no application responses or credentials belong in the content configuration. Applications continue to use the separately activated FormSubmit connection. When switching the visitor site to a new Cloudflare/domain origin, complete FormSubmit's activation for that origin and verify a clearly labeled delivery test before directing applicants there.

## Verification before enabling live edits

- Open the owner URL while signed out: Access must require sign-in.
- Confirm another email cannot publish and direct unsigned API requests fail.
- Publish a small edit and confirm it appears in a new public browser session.
- Hide a test profile and verify its name, bio, and photo are absent from `/api/content`, while the owner dashboard retains it.
- Open two owner tabs and confirm the second stale publication reports a conflict.
- Confirm analytics numbers come from the selected zone, with no fake sample rows.

Local server checks run with `node --test tests/cloudflare-owner.test.mjs`; they use signed test JWTs, fake storage, and mocked provider responses. They verify authorization and API behavior, but do not establish that your production Access policy, D1 binding, or analytics token has been configured.

References: [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [GraphQL Analytics](https://developers.cloudflare.com/analytics/graphql-api/), [zone analytics metrics](https://developers.cloudflare.com/analytics/graphql-api/migration-guides/zone-analytics/).
