# Volunteer applications and admissions emails

The owner dashboard stores editable acceptance/rejection templates separately from public website content. It supports `{{name}}`, `{{email}}`, and `{{reference}}`. Writing or saving a template never sends email; an owner selects an application, previews the exact recipient and message, and confirms the decision.

## Connect the backend

Use [automatic Cloudflare setup](cloudflare-automatic-setup.md), or configure D1 and Cloudflare Access manually using [owner setup](cloudflare-owner-setup.md). Apply all migrations, including `0003_application_notifications.sql`. The intake endpoint enables only when the database schema and `BTS_APPLICATIONS_ENABLED=true` are present. Private endpoints independently validate signed owner identity.

The allowed owners are `ammarashary@gmail.com` and `breakingtheskyadmissions@gmail.com`. Configure `OWNER_EMAILS` with both comma-separated addresses. A legacy `OWNER_EMAIL` is used only when the list is absent.

## Connect the admissions mailbox

The production sender is **breakingtheskyadmissions@gmail.com**. This uses authenticated Gmail SMTP over implicit TLS on port 465, with a Google App Password stored only in the Worker secret `GMAIL_APP_PASSWORD`. The regular Google password cannot be used. The account must have 2-Step Verification and permit App Passwords.

Runtime settings:

| Name | Value |
| --- | --- |
| `ADMISSIONS_EMAIL` | `breakingtheskyadmissions@gmail.com` |
| `APPLICATION_EMAIL_PROVIDER` | `gmail` |
| `GMAIL_APP_PASSWORD` | A Google-generated App Password, stored as a secret |

New application notifications go to the admissions mailbox with the applicant's address as Reply-To. Acceptances and rejections use the admissions mailbox as both From and Reply-To. The recipient for a decision always comes from the stored application, not from the submitted decision request.

Applications remain saved in the owner inbox if a notification fails. Notification state is separate from acceptance/rejection state and is visible only to owners. Existing FormSubmit applications remain in the mailbox that originally received them; no historical email is forwarded automatically.

The legacy static-site FormSubmit fallback now targets the admissions address and requires that mailbox's FormSubmit activation for the new origin before it can deliver. Its response is checked for setup/activation failures; answers remain available on errors. No failed backend POST automatically switches to a different provider.

## Templates and delivery

Write acceptance and rejection messages in **Owner dashboard → Applications**. Example: `Hi {{name}}, thank you for applying to Breaking the Sky.` Subject templates allow 200 characters, body templates 10,000, and the initial message body is blank. The preview replaces placeholders before sending. Emails are plain text.

The server atomically claims each decision and notification before sending. A final SMTP acceptance response is required before marking an email accepted. An ambiguous disconnect or timeout after message transmission remains locked for checking, preventing an automatic duplicate. SMTP acceptance does not guarantee inbox placement or that the recipient read the message.

For uncertain sends, inspect Gmail's sent mail and the stored record before any manual recovery. Never reset and resend solely because a browser timed out. A tracking Message-ID helps identify the message but is not provider-level idempotency.

An explicitly selected legacy Resend sender remains available for verified non-Gmail domains; it is never used to impersonate the admissions Gmail address.

Run `npm run test:applications` and `npm run test:gmail` for mocked storage/protocol tests. They do not send email. Complete a controlled live test after configuring Gmail, Access, and D1.
