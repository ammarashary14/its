import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = ['index.html', 'team.html', 'apply.html', 'tutoring.html', 'editor.html', 'owner.html'];
const content = new Map(await Promise.all(pages.map(async page => [page, await readFile(path.join(root, page), 'utf8')])));
const errors = [];
let references = 0;
for (const [page, html] of content) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) errors.push(`${page}: duplicate IDs`);
  if ((html.match(/<h1\b/g) || []).length !== 1) errors.push(`${page}: expected one primary heading`);
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    if (/^(https?:|mailto:|tel:|data:)/.test(url)) continue;
    const [targetPath, fragment] = url.split('#');
    const target = targetPath.split('?')[0] || page;
    references++;
    try { await access(path.join(root, target)); }
    catch { errors.push(`${page}: missing ${target}`); }
    if (fragment && content.has(target) && !content.get(target).includes(`id="${fragment}"`)) {
      errors.push(`${page}: missing anchor ${target}#${fragment}`);
    }
  }
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    for (const attr of ['alt', 'width', 'height']) {
      if (!match[0].includes(`${attr}=`)) errors.push(`${page}: image missing ${attr}`);
    }
  }
  for (const match of html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)) {
    for (const id of match[1].split(' ')) {
      if (!ids.includes(id)) errors.push(`${page}: missing ARIA target ${id}`);
    }
  }
}
const css = await readFile(path.join(root, 'assets/style.css'), 'utf8');
for (const match of css.matchAll(/url\(['"]?([^)'" ]+)['"]?\)/g)) {
  try { await access(path.join(root, 'assets', match[1])); }
  catch { errors.push(`CSS: missing ${match[1]}`); }
}
if (errors.length) {
  console.error(errors.join('\n')); process.exitCode = 1;
} else {
  console.log(`Checked ${pages.length} pages and ${references} local links/assets; headings, image metadata, and ARIA targets passed.`);
}
