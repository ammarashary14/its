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

## Cloudflare Pages — after content approval

Connect `ammarashary14/its` to Cloudflare Pages. Use no framework preset, `npm run build` as the build command, and `dist` as the output directory. Set the production branch to `main`. Add the custom domain after deployment. No Cloudflare project or deployment has been created as part of this draft.

## Edit the website

- `index.html`: homepage copy, approach, involvement paths, and FAQs.
- `team.html`: four staff placeholders. Replace the suggested roles, names, bios, and SVG portraits with the actual team. Add/remove an entire `article.staff-card` to change the roster.
- `assets/app.js`: illustrative grade-level lessons, accessible tab interactions, mobile navigation, and inquiry draft downloads.
- `assets/style.css`: colors, typography, and responsive layouts. Brand colors are CSS variables at the top.
- `assets/`: local photos, fonts, and the favicon. All required assets are included; the site makes no third-party requests.
- `_headers`: Cloudflare security headers. Update the content security policy when adding a real form service, analytics, or other integrations.

## Content still to finalize

The organization name and volunteer-school model come from the project brief. Grade bands, lesson content and timings, staff roles, and visual branding are proposals. Curriculum examples and staff profiles are labeled as placeholders. There are no invented impact statistics, endorsements, staff identities, or donation links.

The inquiry dialog validates entries and downloads a plain-text draft to the visitor's device. **It does not submit information to BTS.** Entries are not stored in browser storage; closing the dialog clears them. Before launch, connect an approved submission destination, add contact information, confirm the volunteer process and grade coverage, and publish an appropriate privacy notice for the data collected.

## Assets

Photos are illustrative stock images, not photos of BTS participants. Replace them with approved organization photography when available.

- Illustrative classroom photo: [Unsplash image source](https://images.unsplash.com/photo-1509062522246-3755977927d7).
- Illustrative library photo: [Unsplash image source](https://images.unsplash.com/photo-1427504494785-3a9ca7044f45).
- Manrope by Mikhail Sharanda and contributors, distributed under the SIL Open Font License; see `assets/OFL-Manrope.txt`.
- Brand marks, decorative SVG graphics, and staff placeholder illustrations were made for this draft.

## Verification

`npm run check` checks JavaScript syntax, internal links and assets, unique page IDs, primary headings, image metadata, and ARIA relationships. Additional DOM interaction checks are run during development. Visual browser QA still needs to be performed in an environment with an available browser preview.
