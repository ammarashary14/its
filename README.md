# BTS · Breaking the Sky

A first website draft for a nonprofit whose volunteers bring grade-level curriculum into schools. Built with static HTML, CSS, and JavaScript. No production framework or package installation is required.

## Preview locally

Run `npm run dev`, then open `http://localhost:3000`. Python 3 is needed for this convenience server. The pages also work by opening `index.html` directly in a modern browser.

## Check and build

Requires Node.js 20 or later:

```sh
npm run check
npm run build
```

The build copies only website files into `dist/`; source tooling and work files are excluded.

## GitHub Pages preview

The site can be served directly from the repository root. In the repository's **Settings → Pages**, choose **Deploy from a branch**, select **main** and **/ (root)**, then save. The expected preview address is `https://ammarashary14.github.io/its/` once GitHub reports a successful deployment. `.nojekyll` keeps GitHub from processing this static site through Jekyll. All asset and page links are relative, so the `/its/` project path works without changes. The Cloudflare-only `_headers` file is not applied by GitHub Pages.

## Cloudflare Pages — after content approval

Connect `ammarashary14/its` to Cloudflare Pages. Use no framework preset, `npm run build` as the build command, and `dist` as the output directory. Set the production branch to `main`. Add the custom domain after deployment. No Cloudflare project or deployment has been created as part of this draft.

## Edit the website

- `index.html`: homepage copy, central grade-level curriculum immediately below the introduction, classroom photo, approach, involvement paths, contact, and FAQs.
- `team.html`: four staff placeholders. Replace the suggested roles, names, bios, and SVG portraits with the actual team. Add/remove an entire `article.staff-card` to change the roster.
- `apply.html`: volunteer application with interests, grade preferences, availability, experience, and motivation.
- `tutoring.html`: tutoring request with contact information, grade, subjects, goals, format, and availability.
- `assets/app.js`: illustrative grade-level lessons, accessible tab interactions, and mobile navigation.
- `assets/style.css`: base typography and responsive layouts.
- `assets/theme.css`: warm linen beige, charcoal typography, centered curriculum, neutral dark mode, and form layouts. Edit the theme variables at the top to change the palette.
- `assets/theme.js`: starts in light mode; an explicitly chosen light/dark preference is saved in `localStorage` under `bts-theme` and shared across pages.
- `assets/forms.js`: client-side validation, review/edit, direct volunteer application delivery through FormSubmit, and tutoring email drafts. Change `recipient` and the FormSubmit endpoint here, and the visible contact links in the HTML, to update the recipient. A new recipient or site origin requires FormSubmit activation.
- `editor.html` and `assets/editor.js`: edit the volunteer application with a live preview, add/remove/reorder questions, and import/export draft configuration.
- `assets/application-config.js`: the published volunteer application schema and validation. `assets/application.js` renders the questions and optionally previews a local draft.
- `assets/`: local photos, fonts, and the favicon. All visual assets are included. The volunteer application sends a request to FormSubmit only after the applicant reviews and submits it.
- `_headers`: Cloudflare security headers. Update the content security policy when adding a real form service, analytics, or other integrations.

## Content still to finalize

The organization name and volunteer-school model come from the project brief. Grade bands, lesson content and timings, staff roles, and visual branding are proposals. Curriculum examples and staff profiles are labeled as placeholders. There are no invented impact statistics, endorsements, staff identities, or donation links.

Volunteer applications are reviewed and submitted directly from the website to **ammarashary@gmail.com** through [FormSubmit](https://formsubmit.co/). The page shows success only after the service acknowledges the submission; it does not promise inbox placement. Sending disables repeat clicks, errors retain answers, and a timeout explains that receipt is uncertain. A copy/contact fallback remains available. FormSubmit processes submission data under its [privacy policy](https://formsubmit.co/privacy). Its recipient activation must be completed for each hosting origin before accepting applications; repeat a clearly labeled setup test and confirm inbox delivery when changing the endpoint or domain. The browser does not store applicant responses in localStorage or sessionStorage. Theme preferences and draft question settings are the only local persistence. Local editor previews cannot send real applications; the published application remains available through `apply.html?published=1`.

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
