import { validateSiteContent, SITE_DRAFT_KEY } from './content-schema.js?v=full-11';

const page = document.body?.dataset.page;
const preview = new URLSearchParams(window.location.search).get('preview') === '1';
const avatarTemplates = new Map([...document.querySelectorAll('[data-site-people] .staff-avatar')].map((node, index) => [`staff-${index + 1}`, node.cloneNode(true)]));
let publishedContent = null;
let previewBanner = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function fieldValue(content, key) {
  const [section, name, extra] = key.split('.');
  if (extra || !['home', 'team', 'community'].includes(section) || !Object.hasOwn(content[section], name)) return null;
  return content[section][name];
}
function heroHeadline(node, value) {
  const underline = node.querySelector('svg')?.cloneNode(true);
  const split = value.lastIndexOf(' ');
  const prefix = split < 0 ? '' : value.slice(0, split + 1);
  const finalWord = split < 0 ? value : value.slice(split + 1);
  const highlight = element('span', 'highlight-word', finalWord);
  if (underline) highlight.append(underline);
  node.replaceChildren(document.createTextNode(prefix), highlight);
}
function avatar(person) {
  if (person.photo) {
    const holder = element('div', 'staff-avatar has-photo');
    const image = element('img', 'staff-photo');
    image.src = person.photo;
    image.alt = person.photoAlt || `Portrait of ${person.name}`;
    image.width = 640; image.height = 800; image.loading = 'lazy'; image.decoding = 'async';
    holder.append(image);
    return holder;
  }
  const original = avatarTemplates.get(person.id);
  if (original) return original.cloneNode(true);
  const holder = element('div', 'staff-avatar');
  const image = element('img', 'staff-photo');
  image.src = 'assets/staff-placeholder.svg'; image.alt = ''; image.width = 320; image.height = 320;
  holder.append(image, element('span', 'placeholder-tag', 'Photo placeholder'));
  return holder;
}
function icon(name) {
  const image = element('img', 'social-icon');
  image.src = `assets/icon-${name}.svg`; image.alt = ''; image.width = 20; image.height = 20;
  return image;
}
function profileContacts(person) {
  if (!person.email && !person.discord) return null;
  const contacts = element('div', 'staff-contacts');
  if (person.email) {
    const email = element('a', 'staff-contact');
    email.href = `mailto:${encodeURIComponent(person.email)}`;
    email.setAttribute('aria-label', `Email ${person.name}: ${person.email}`);
    email.append(icon('gmail'), element('span', '', person.email));
    contacts.append(email);
  }
  if (person.discord) {
    const button = element('button', 'staff-contact staff-contact-copy'); button.type = 'button';
    button.setAttribute('aria-label', `Copy ${person.name}’s Discord username: ${person.discord}`);
    const username = element('span', '', person.discord);
    button.append(icon('discord'), username, element('small', '', 'Copy'));
    const status = element('p', 'staff-contact-status'); status.setAttribute('role', 'status');
    button.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(person.discord);
        status.textContent = 'Discord username copied.';
      } catch {
        const selection = window.getSelection(); const range = document.createRange();
        range.selectNodeContents(username); selection?.removeAllRanges(); selection?.addRange(range);
        status.textContent = 'Username selected. Use Copy, then add them on Discord.';
      }
    });
    contacts.append(button, status);
  }
  return contacts;
}
function communityLinks(content) {
  const holder = document.querySelector('[data-community-links]');
  if (!holder) return;
  const discord = element(content.discordInvite ? 'a' : 'button', 'community-link');
  if (content.discordInvite) {
    discord.href = content.discordInvite; discord.target = '_blank'; discord.rel = 'noopener noreferrer';
  } else { discord.type = 'button'; discord.disabled = true; }
  const discordText = element('span');
  discordText.append(element('strong', '', content.discordInvite ? 'Join our Discord server' : 'Discord'), element('small', '', content.discordInvite ? content.name : 'Invite coming soon'));
  discord.append(icon('discord'), discordText);
  if (content.discordInvite) { const arrow = element('span', '', '↗'); arrow.setAttribute('aria-hidden', 'true'); discord.append(arrow); }
  const email = element('a', 'community-link'); email.href = `mailto:${encodeURIComponent(content.email)}`;
  const emailText = element('span'); emailText.append(element('strong', '', 'Email us'), element('small', '', content.email));
  const arrow = element('span', '', '↗'); arrow.setAttribute('aria-hidden', 'true');
  email.append(icon('gmail'), emailText, arrow);
  holder.replaceChildren(discord, email);
}
function socialLinks(content) {
  document.querySelectorAll('[data-social-links]').forEach(holder => {
    const featured = holder.dataset.socialDisplay === 'community';
    const items = [];
    for (const [key, label] of [['instagram', 'Instagram'], ['facebook', 'Facebook']]) {
      const href = content[key];
      if (!href && !featured) continue;
      const item = element(href ? 'a' : 'div', 'social-link' + (href ? '' : ' social-link-pending'));
      if (href) {
        item.href = href; item.target = '_blank'; item.rel = 'noopener noreferrer';
        item.setAttribute('aria-label', `Breaking the Sky on ${label} (opens in a new tab)`);
      }
      const caption = element('span', 'social-link-caption');
      caption.append(element('strong', '', label));
      if (featured) caption.append(element('small', '', href ? 'Follow Breaking the Sky' : 'Coming soon'));
      item.append(icon(key), caption);
      if (href) { const arrow = element('span', 'social-link-arrow', '↗'); arrow.setAttribute('aria-hidden', 'true'); item.append(arrow); }
      items.push(item);
    }
    holder.replaceChildren(...items);
    holder.hidden = !items.length;
  });
}
function schoolPartners(schools) {
  document.querySelectorAll('[data-site-schools]').forEach(holder => {
    if (!schools.length) { holder.replaceChildren(element('p', 'schools-empty', 'School partnerships will appear here.')); return; }
    holder.replaceChildren(...schools.map(school => {
      const card = element('article', 'school-card');
      const copy = element('div', 'school-card-copy');
      copy.append(element('h2', 'school-name', school.name));
      const details = [school.location, school.grades].filter(Boolean).join(' · ');
      if (details) copy.append(element('p', 'school-location', details));
      if (school.description) copy.append(element('p', 'school-description', school.description));
      if (school.website) {
        const link = element('a', 'school-link', 'Visit school website ↗');
        link.href = school.website; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `Visit ${school.name}’s website (opens in a new tab)`);
        copy.append(link);
      }
      card.append(copy);
      return card;
    }));
  });
}
function donationLink(settings) {
  document.querySelectorAll('[data-donation-link]').forEach(link => {
    link.hidden = !settings.url;
    if (settings.url) { link.href = settings.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    else { link.removeAttribute('href'); link.removeAttribute('target'); link.removeAttribute('rel'); }
  });
  document.querySelectorAll('[data-donation-empty]').forEach(message => { message.hidden = Boolean(settings.url); });
}
export function renderSiteContent(raw) {
  const content = validateSiteContent(raw);
  document.querySelectorAll('[data-site-field]').forEach(node => {
    const value = fieldValue(content, node.dataset.siteField);
    if (value !== null) {
      node.textContent = value;
      if (node.dataset.siteField === 'team.titleAccent') node.hidden = !value;
    }
  });
  document.querySelectorAll('[data-site-break]').forEach(node => {
    node.hidden = !fieldValue(content, node.dataset.siteBreak);
  });
  document.querySelectorAll('[data-site-headline]').forEach(node => {
    const value = fieldValue(content, node.dataset.siteHeadline);
    if (value !== null) heroHeadline(node, value);
  });
  const grid = document.querySelector('[data-site-people]');
  if (grid) {
    const cards = content.people.filter(person => person.visible).map(person => {
      const card = element('article', 'staff-card');
      const info = element('div', 'staff-info');
      if (person.placeholder) info.append(element('small', '', 'Suggested role'));
      info.append(element('h3', '', person.name), element('p', 'staff-role', person.role), element('p', 'staff-bio', person.bio));
      const contacts = profileContacts(person);
      if (contacts) info.append(contacts);
      card.append(avatar(person), info);
      return card;
    });
    grid.replaceChildren(...cards);
    if (!cards.length) grid.append(element('p', 'team-empty', 'Meet the people behind BTS here soon.'));
  }
  communityLinks(content.community);
  socialLinks(content.community);
  schoolPartners(content.schools);
  donationLink(content.donation);
  document.dispatchEvent(new CustomEvent('bts:content-updated', { detail: { preview } }));
}
function readDraft() {
  try {
    const saved = localStorage.getItem(SITE_DRAFT_KEY);
    if (!saved || saved.length > 2 * 1024 * 1024) return null;
    const envelope = JSON.parse(saved);
    return validateSiteContent(envelope.content);
  } catch { return null; }
}
function showPreviewBanner(hasDraft) {
  if (!previewBanner) {
    previewBanner = element('aside', 'site-preview-banner');
    previewBanner.setAttribute('aria-label', 'Local site preview');
    document.querySelector('main')?.before(previewBanner);
  }
  const title = element('strong', '', 'Local draft preview');
  const description = element('p', '', hasDraft
    ? 'These edits are visible only in this browser. Visitors still see the published website.'
    : 'No valid saved draft was found in this browser. You’re viewing the published website.');
  const ownerLink = element('a', '', 'Back to owner dashboard'); ownerLink.href = 'owner.html';
  const exit = element('a', '', 'View published website');
  const url = new URL(window.location.href); url.searchParams.delete('preview'); exit.href = url.pathname + url.search + url.hash;
  previewBanner.replaceChildren(title, description, ownerLink, document.createTextNode(' · '), exit);
}
async function json(path) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(new URL(path, document.baseURI), { credentials: 'same-origin', cache: 'no-cache', signal: controller.signal });
    if (!response.ok) throw new Error('Content unavailable');
    return await response.json();
  } finally { window.clearTimeout(timeout); }
}
async function initialize() {
  if (preview) {
    const draft = readDraft();
    showPreviewBanner(Boolean(draft));
    if (draft) renderSiteContent(draft);
  }
  const [fallback, remote] = await Promise.allSettled([json('assets/site-content.json'), json('api/content')]);
  if (fallback.status === 'fulfilled') {
    try { publishedContent = validateSiteContent(fallback.value); } catch {}
  }
  if (remote.status === 'fulfilled' && remote.value?.content) {
    try { publishedContent = validateSiteContent(remote.value.content); } catch {}
  }
  const draft = preview ? readDraft() : null;
  if (draft) renderSiteContent(draft);
  else if (publishedContent) renderSiteContent(publishedContent);
  if (preview) showPreviewBanner(Boolean(draft));
}
if (['home', 'team', 'curriculum', 'community', 'contact', 'tutoring', 'apply', 'sponsors', 'schools', 'donate'].includes(page)) {
  initialize().catch(() => { /* Keep the complete, server-served HTML if data is unavailable. */ });
  if (preview) window.addEventListener('storage', event => {
    if (event.key !== SITE_DRAFT_KEY) return;
    const draft = readDraft();
    if (draft) renderSiteContent(draft);
    else if (publishedContent) renderSiteContent(publishedContent);
    showPreviewBanner(Boolean(draft));
  });
}
