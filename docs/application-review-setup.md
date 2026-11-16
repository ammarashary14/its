# Volunteer application review and email decisions

The owner dashboard has editable acceptance/rejection messages and an application inbox. GitHub Pages still uses the activated FormSubmit delivery to the existing Gmail inbox. Automatic decisions are unavailable until the Cloudflare backend and email sender below are configured. Existing FormSubmit email history is not imported automatically.

## Connect the private inbox

1. Complete [Cloudflare owner setup](cloudflare-owner-setup.md), including Cloudflare Access on `/owner.html` and `/api/owner/*` and the `BTS_DB` D1 binding. The server independently verifies the signed Access token and owner email on every private endpoint.
2. Apply `migrations/0002_applications.sql` to the same D1 database. It creates separate `applications` and `application_settings` tables. These records and email templates are never part of the public site-content export.
3. Deploy the Pages Functions from this repository with the site. Set `BTS_APPLICATIONS_ENABLED=true` only when the application inbox is ready. `GET /api/applications` advertises enabled intake only when this flag, D1, and the migration are available.
4. Submit a clearly labeled test application from the new website origin and verify that it appears in the owner inbox. Public submissions are stored in D1; they do not send an owner notification email. The owner list shows the latest 100 records. Applications submitted through the earlier FormSubmit workflow remain in Gmail.

Protect the public POST endpoint with Cloudflare rate limits appropriate to expected applications before opening intake. Request validation, a honeypot, size limits, same-origin JSON requests, and unique application references are included; these are not a substitute for edge rate limits against automated storage abuse. Set a retention policy for applicants' personal details and restrict D1/account access to the people who need it.

## Connect decision emails

Create a Resend account and verify a sending domain. Configure these **server-only** Pages runtime secrets/settings:

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | A Resend key authorized to send from the verified domain. |
| `APPLICATION_FROM_EMAIL` | A bare sender email at that verified domain, for example `applications@your-domain.org`. |
| `OWNER_EMAIL` | The existing dashboard owner email; it is also the decision email reply-to address. |

Do not put API keys in public assets, GitHub, the content JSON, or a dashboard text field. No key is included in this project.

In **Owner dashboard → Applications**, write and save the acceptance and rejection messages. Templates support `{{name}}`, `{{email}}`, and `{{reference}}`. Subject lines allow up to 200 characters; template bodies allow up to 10,000. The initial body is blank. Choose an application, review the rendered recipient/subject/body, and confirm **Accept & send** or **Reject & send**. Only that explicit action sends an email, always to the address stored on the application. Emails are plain text.

## Sending and recovery

The server atomically claims a pending application before contacting Resend. A stable provider idempotency key and a stored sending state prevent concurrent clicks from sending separate decisions. A confirmed provider acceptance records `accepted` or `rejected`; it means the provider accepted the email, not that the recipient read it or that inbox delivery is guaranteed.

A definite provider rejection leaves the application pending with an error so the configuration or message can be corrected. A network timeout, ambiguous provider result, or failed final database update leaves `delivery_uncertain` or `sending`. These states cannot be retried from the dashboard. Check the Resend email log and database record before any manual recovery; do not reset and resend merely because the browser timed out. If the provider confirms receipt, reconcile the decision and provider ID. If it confirms no send occurred, an authorized operator can return the record to pending after reviewing the saved subject/body. Provider idempotency retention is limited, so it does not authorize an automatic resend later.

`npm run test:applications` (when added to package scripts) or `node --test tests/applications-api.test.mjs` runs SQLite-backed storage, identity, validation, concurrent decision, provider rejection, and uncertain delivery tests. Tests mock all email requests; they do not send messages.
