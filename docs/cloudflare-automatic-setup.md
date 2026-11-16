# Finish the BTS Cloudflare connection

The public Worker `its` and `breakingthesky.com` are selected for this project. The repository contains a setup command that creates the dedicated database, applies its schema, configures owner sign-in, and deploys the connected Worker. It runs in the existing authenticated Cloudflare build environment. No token belongs in this repository or in chat.

## One-time Cloudflare setup

1. Edit the existing **bts-build-token** in Cloudflare's API token settings. Keep its deployment permissions and add these **Account** permissions for this account only:
   - **D1 → Edit**
   - **Access: Apps and Policies → Edit**
   - **Access: Organizations, Identity Providers, and Groups → Edit**
2. In **Workers & Pages → its → Settings → Build**, keep the build command `npm run build`. Change the **Deploy command** to `npm run deploy`, and retain the BTS build token.
3. Retry the latest build. The setup command reuses or creates only the `bts-site` database, applies `migrations/`, configures the BTS Access application, and deploys with `BTS_DB` and the returned identity settings. It stops on missing permissions or ambiguous existing resources. If Cloudflare requires initial Zero Trust onboarding, complete that in the dashboard and retry; the script does not change billing or subscription plans.

The two authorized owner addresses are:

- `ammarashary@gmail.com`
- `breakingtheskyadmissions@gmail.com`

After a successful setup build, open `https://breakingthesky.com/owner.html` and request an email sign-in code using either address. The `/owner`, `/owner.html`, and `/api/owner/*` routes use the same Access application. Public website pages remain public. Use the custom domain for owner sign-in; unsigned requests through an alternate hostname cannot use private APIs.

The generated `.bts-cloudflare.runtime.json` contains only configuration and resource identifiers, is ignored by Git, and is removed when the command finishes. It is regenerated on each deployment. Keep using `npm run deploy` so the database and sign-in bindings are retained. An offline `npm run deploy -- --check` describes the plan without contacting Cloudflare.

## Gmail sending

While signed into `breakingtheskyadmissions@gmail.com`, enable Google 2-Step Verification and generate an App Password named **BTS website**. Save it in **Worker its → Settings → Variables and Secrets** as a **Secret** named `GMAIL_APP_PASSWORD`, then deploy the settings. Do not use the regular Google password.

The source/runtime settings select `APPLICATION_EMAIL_PROVIDER=gmail` and `ADMISSIONS_EMAIL=breakingtheskyadmissions@gmail.com`. New application notifications go to that mailbox. Decision emails are authenticated through that mailbox and sent from it. Changing email settings does not forward old messages or import previous FormSubmit history.

If Google does not offer App Passwords after 2-Step Verification is enabled, its account restrictions must be resolved or a supported OAuth sender connection chosen. Do not weaken sign-in requirements to enable mailing.

After the backend and sender are connected, submit a clearly labeled test application using an address you control, check that the notification arrives and the record appears in the owner inbox, then test an owner-reviewed decision. Local tests and secret presence alone do not verify real Gmail delivery.

## Remaining optional connections

Traffic analytics still uses the separately scoped zone analytics token described in [owner setup](cloudflare-owner-setup.md). Instagram, Facebook, school records, and the donation link can be filled in from the connected dashboard; they intentionally start empty.
