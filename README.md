# BTS · Breaking the Sky

A first website draft for a nonprofit whose volunteers bring grade-level curriculum into schools. Built with static HTML, CSS, and JavaScript, with a Cloudflare Worker for owner publishing, application review, and analytics. Static previews need no package installation; Cloudflare deployment uses the pinned Wrangler development dependency.

## Preview locally

Run `npm run dev`, then open `http://localhost:3000`. Python 3 is needed for this convenience server. The pages also work by opening `index.html` directly in a modern browser.

## Check and build

Requires Node.js 22 or later:

```sh
npm run check
npm run build
```

The build copies only website files into `dist/`; source tooling and work files are excluded.

## GitHub Pages preview

The site can be served directly from the repository root. In the repository's **Settings → Pages**, choose **Deploy from a branch**, select **main** and **/ (root)**, then save. The expected preview address is `https://ammarashary14.github.io/its/` once GitHub reports a successful deployment. `.nojekyll` keeps GitHub from processing this static site through Jekyll. All asset and page links are relative, so the `/its/` project path works without changes. The Cloudflare-only `_headers` file is not applied by GitHub Pages.

## Cloudflare deployment

The Cloudflare **Workers** Git setup uses project name `its` and build command `npm run build`. Use deploy command `npm run deploy` to configure the database and owner access automatically after granting the documented build-token permissions. See [automatic setup](docs/cloudflare-automatic-setup.md). The committed `wrangler.jsonc` serves `dist/` through the ASSETS binding and routes `/api/*` to `server/worker.js`. It preserves dashboard variables with `keep_vars`. Live owner actions remain disabled until database and sign-in setup succeeds; email sending also requires the admissions mailbox’s App Password.

The setup command creates or reuses the dedicated D1 database and configures Cloudflare Access for both authorized owners before enabling persistent editing. Manual setup is documented in [owner setup](docs/cloudflare-owner-setup.md); Gmail configuration is documented in [application review setup](docs/application-review-setup.md). The owner has attached and approved `breakingthesky.com` for launch.

The `functions/` adapters also remain available for a Cloudflare Pages deployment using build command `npm run build` and output `dist`.

## Edit the website

- `index.html`: an illustrated homepage with a math notebook, subject overview, learning pathways, and volunteer call to action.
- `curriculum.html`, `community.html`, and `contact.html`: dedicated destinations for the main navigation; the curriculum grade browser and contact routes are preserved.
- `team.html`: four staff placeholders. Replace the suggested roles, names, bios, and SVG portraits with the actual team. Add/remove an entire `article.staff-card` to change the roster.
- `apply.html`: volunteer application with interests, grade preferences, availability, experience, and motivation.
- `calendar.html`: public month calendar and upcoming events, managed in the owner dashboard. Starts empty until events are published.
- `tutoring.html` and `assets/tutoring.js`: tutoring requests submitted directly on the website, with contact information, grade, subjects, goals, format, and availability.
- `schools.html`, `sponsors.html`, and `donate.html`: school partnerships, sponsorship information, and the donation destination. Schools and the donation link start empty until the owner adds them.
- `assets/app.js`: illustrative grade-level lessons, accessible tab interactions, and mobile navigation.
- `assets/style.css`: base typography and responsive layouts.
- `assets/theme.css`: warm linen beige, charcoal typography, centered curriculum, neutral dark mode, and form layouts. Edit the theme variables at the top to change the palette.
- `assets/theme.js`: starts in light mode; an explicitly chosen light/dark preference is saved in `localStorage` under `bts-theme` and shared across pages.
- `assets/forms.js`: client-side validation, review/edit, volunteer application delivery, and tutoring email drafts. It uses FormSubmit on the current preview; a configured Cloudflare intake can store new applications for owner review. A failed submission never switches providers automatically. A new FormSubmit recipient or site origin requires activation.
- `owner.html` and `assets/owner.js`: owner dashboard for site content, community links, staff profiles, calendar events, and aggregate site statistics.
- `assets/site-content.json`, `assets/content-schema.js`, and `assets/site-content.js`: published content defaults, shared validation, and public rendering. Local drafts appear only with `?preview=1`.
- `functions/api/` and `server/`: Cloudflare owner authentication, D1 publishing, and traffic analytics APIs. See `docs/cloudflare-owner-setup.md`.
- `editor.html` and `assets/editor.js`: edit the volunteer application with a live preview, add/remove/reorder questions, and import/export draft configuration.
- `assets/application-config.js`: the published volunteer application schema and validation. `assets/application.js` renders the questions and optionally previews a local draft.
- `assets/`: local photos, fonts, and the favicon. All visual assets are included. Application answers are sent only after the applicant reviews and submits them.
- `_headers`: Cloudflare security headers. Update the content security policy when adding a real form service, analytics, or other integrations.

## Content still to finalize

The organization name and volunteer-school model come from the project brief. Grade bands, lesson content and timings, staff roles, and visual branding are proposals. Curriculum examples and staff profiles are labeled as placeholders. There are no invented impact statistics, endorsements, staff identities, or donation links.

The static fallback submits volunteer applications to **breakingtheskyadmissions@gmail.com** through [FormSubmit](https://formsubmit.co/). The page shows success only after the service acknowledges the submission; it does not promise inbox placement. Sending disables repeat clicks, errors retain answers, and a timeout explains that receipt is uncertain. A copy/contact fallback remains available. FormSubmit processes submission data under its [privacy policy](https://formsubmit.co/privacy). Its recipient activation must be completed for each hosting origin before accepting applications; repeat a clearly labeled setup test and confirm inbox delivery when changing the endpoint or domain. The browser does not store applicant responses in localStorage or sessionStorage. Theme preferences and draft question settings are the only local persistence. Local editor previews cannot send real applications; the published application remains available through `apply.html?published=1`.

Tutoring requests continue to prepare a prefilled email that visitors send in their email app. A submitted application does not confirm volunteer placement or book a tutoring session. Confirm the volunteer process and grade coverage before final launch.

## Customize the volunteer application

Open `editor.html` to edit the title, introduction, review-button text, and up to 30 questions. Supported question types are short answer, long answer, email, dropdown, and checkbox. The name and email questions stay required. Draft question settings are stored only in this browser under `bts-application-draft-v1`; applicants' answers are never saved there.

The application page previews that draft on the same device and clearly labels it. `apply.html?published=1` always shows the published questions. Other visitors continue to see the published form. Export `bts-volunteer-application.json` to save or share a draft; the editor can import it later. To publish a completed export, validate it with `BTSApplication.validate`, replace `defaultConfig` in `assets/application-config.js`, update the no-JavaScript fallback if needed, and commit/push the site. The editor does not claim to publish globally or provide private administration on GitHub Pages.

## Assets

Photos are illustrative stock images, not photos of BTS participants. Replace them with approved organization photography when available.

- Illustrative classroom photo: [Unsplash image source](https://images.unsplash.com/photo-1509062522246-3755977927d7).
- Illustrative library photo: [Unsplash image source](https://images.unsplash.com/photo-1427504494785-3a9ca7044f45).
- Manrope by Mikhail Sharanda and contributors, distributed under the SIL Open Font License; see `assets/OFL-Manrope.txt`.
- Brand marks, decorative SVG graphics, and staff placeholder illustrations were made for this draft.

## Verification

`npm run check` checks JavaScript syntax, internal links and assets, unique page IDs, primary headings, image metadata, and ARIA relationships. Additional DOM interaction checks are run during development. Visual browser QA still needs to be performed in an environment with an available browser preview.

## Owner dashboard

Open `owner.html`. The current GitHub Pages and owner-private preview deployments support a draft workspace: edit homepage/team copy, manage profile names, roles, biographies, photos, visibility and order, and set community contact links. Save drafts on the current device, preview the homepage or team page, and export `bts-site-content.json` for publication. The dashboard also links to the existing application editor. It does not receive or store applicant submissions.

The public community section has a Discord join button and an email link. Its Discord invite is intentionally empty until the owner adds it under **Site content → Community**. Optional profile Discord usernames can be copied; profile email addresses open an email draft. No Discord invite or username has been invented. Discord and Gmail symbols are local SVG assets from [Simple Icons](https://simpleicons.org/).

Before Cloudflare is connected, **Publish changes** is disabled and traffic metrics are marked unavailable. There is no client-side password or pretend authentication. The existing private preview uses its platform access controls; the public GitHub dashboard shell only edits drafts in the visitor’s browser.

Dashboard exports include a content payload and draft revision metadata. Preserve that envelope when importing back into the dashboard. When importing a file here for manual publication, validate its content payload and exclude hidden profiles from any public JSON or HTML. Exports may include hidden profiles, so keep backup files in private storage. On the connected Cloudflare backend, hidden records stay in D1 and are omitted by the public content API; the authenticated owner API returns them for editing.

Follow [Cloudflare owner setup](docs/cloudflare-owner-setup.md) when connecting hosting. The backend supports verified Cloudflare Access identity, same-origin publication, optimistic revision checks, and aggregate statistics stored in the existing D1 database. The automatic deployment applies the analytics migration and enables collection; its production result still needs verification. Run `npm run test:owner` for the backend checks; browser UI verification requires an available browser environment.

## Site statistics

The default stats view uses the existing `BTS_DB` database; no separate analytics token is required. Automatic setup applies `migrations/0004_site_analytics.sql` and sets `BTS_SITE_ANALYTICS_ENABLED=true`. Public pages send only a fixed page path to `/api/page-view`, which stores daily/path counters without IP addresses, referrers, query strings, cookies, or user IDs.

The dashboard shows page views, saved applications, and active pages for the last 7 or 30 UTC calendar days, including today, plus daily views and applications. Page views are approximate counts, not people; collection starts when enabled and has no historical backfill. Application totals count records saved within the selected period, without importing previous FormSubmit emails. The optional Cloudflare zone provider remains documented in [owner setup](docs/cloudflare-owner-setup.md).

## Adjust profile photos

In **Owner dashboard → Team profiles**, upload a JPG, PNG, or WebP photo, or choose **Crop / adjust photo** on an existing profile. Drag or use the position controls to frame it, zoom in, rotate, or reset. Apply the crop, then save the draft. Cancel leaves the previous photo unchanged. The editor creates a 640 × 800 portrait crop so the dashboard and public team page use the same 4:5 frame. Editing stays in the browser; no photo is uploaded to a third-party editing service.

Only the applied crop is included in saved drafts and exports. To restore an area outside an earlier crop after reloading, upload the original photo again. The cropper lives in `assets/photo-cropper.js` and `assets/photo-cropper.css`; `npm run test:photos` verifies the crop geometry.

## Schools, social profiles, and donations

Use **Owner dashboard → Schools served** to add school names, locations, grade levels, a short partnership description, and optional school websites. Use **Site content → Social media** for Instagram and Facebook, and the donation-link field for a hosted donation page. These settings follow the same save, preview, export, and Cloudflare publication workflow as other website content. The new fields default to empty in older saved drafts.

Blank social profiles show “Coming soon” on the Community page and stay out of the footer. Blank donation settings display the upcoming-donations message instead of a payment button. No school or sponsor endorsements are fabricated. `npm run test:content` checks the added data and URL validation.

The owner registered and attached `breakingthesky.com` at Cloudflare and approved launch. On November 16, 2026, the deployment succeeded and live checks confirmed public pages, enabled application intake, D1 content access, a recorded page-view event, and the owner sign-in redirect. The owner sign-in code email was delivered. Authenticated dashboard actions and admissions Gmail delivery still need a complete live test.

## Application review and decision emails

**Owner dashboard → Applications** now includes an inbox area and separate acceptance/rejection message editors. Write a subject and message with `{{name}}`, `{{email}}`, and `{{reference}}`, preview them, and save or export the message draft. Templates are separate from website content and contain no applicant records. Saving a message never sends email.

GitHub Pages and the static private preview cannot receive applications into this inbox or send decision emails. Existing FormSubmit submissions remain in the email inbox. Once [application review setup](docs/application-review-setup.md) is completed, new submissions can go into private D1 storage. The authenticated owner can select a record, choose Accept or Reject, review the recipient and exact message, then send. Only an acknowledged email-provider response marks the decision sent; ambiguous delivery is locked for checking to prevent duplicate messages. The domain is attached by the owner. Gmail and live owner access require the documented account setup; code and local tests alone do not verify those connections.

`npm run test:applications` verifies the private endpoints, real SQLite storage behavior, revisions, and duplicate-send protection with mocked email delivery.


## Calendar

Open **Owner dashboard → Calendar** to set the calendar’s IANA time zone and add events. Each event has a title, date, optional start/end time, category, location, description, and optional HTTPS details link. New events start hidden. Enable **Show on public calendar**, save a draft, preview it, then publish through the owner dashboard. Blank times are all-day events; timed events end later on the same day.

The public month view supports previous/next/today, date selection, and upcoming events. Dates stay in the calendar’s configured time zone rather than shifting with the visitor’s device. Hidden events are omitted from the public content API and retained in authenticated owner content. Older content and exports default to an empty calendar in UTC.

`npm run test:calendar` checks shared validation, hidden event handling, date boundaries, and calendar behavior. Migration `0005_calendar_analytics.sql` adds calendar page counting while preserving existing statistics.


## Tutoring requests

The tutoring page reviews and submits requests to `/api/tutoring`. Successful requests are stored in the private `tutoring_requests` D1 table and appear in **Owner dashboard → Tutoring requests**. The inbox shows the 100 most recent requests; it is protected by the same verified owner sign-in as application review. Request details are not saved to browser storage.

Notification emails use the configured admissions Gmail sender and go only to `ammarashary@gmail.com`, with the requester as Reply-To. A request stays saved even if email delivery fails. The owner inbox shows each notification's delivery status. Submitting the same reference and details again does not create a second request or notification. An uncertain client response keeps the original reference for a safe retry.

Automatic deployment applies `0006_tutoring_requests.sql` before setting `BTS_TUTORING_ENABLED=true`. This feature uses the existing database, owner access, and Gmail secret; no new account setup is required. Run `npm run test:tutoring` for validation, storage, access, and notification checks with mocked delivery.
