/** Shared browser/Cloudflare schema. This file contains no private owner data. */
export const SITE_DRAFT_KEY = 'bts-site-draft-v1';
export const CONTENT_LIMITS = Object.freeze({ people: 20, schools: 30, photo: 350 * 1024, document: Math.floor(1.8 * 1024 * 1024) });
const homeFields = Object.freeze({
  headline: 160, headlineAccent: 160, description: 2000,
  curriculumTitle: 160, curriculumAccent: 160, curriculumIntro: 2000,
  aboutTitle: 160, aboutAccent: 160, aboutText: 2000,
  tutoringTitle: 160, tutoringAccent: 160, tutoringIntro: 2000,
  contactIntro: 2000
});
const teamFields = Object.freeze({ title: 160, titleAccent: 160, intro: 2000, sectionIntro: 2000 });
const communityFields = Object.freeze({ name: 100, description: 1000 });
export const COMMUNITY_DEFAULTS = Object.freeze({
  name: 'Breaking the Sky community',
  description: 'Join our Discord community for updates, conversations, and ways to get involved.',
  discordInvite: '',
  email: 'ammarashary@gmail.com',
  instagram: '',
  facebook: ''
});
export const SITE_TEXT_FIELDS = Object.freeze({ home: homeFields, team: teamFields, community: communityFields });
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object.`);
  return value;
}
function text(value, label, maximum, optional = false) {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const result = value.trim();
  if ((!optional && !result) || result.length > maximum) throw new Error(`${label} must contain ${optional ? 'no more than' : 'between 1 and'} ${maximum} characters.`);
  return result;
}
function section(value, fields, label, optionalKeys = []) {
  object(value, label);
  const result = {};
  for (const [key, maximum] of Object.entries(fields)) result[key] = text(value[key], `${label}: ${key}`, maximum, optionalKeys.includes(key));
  return result;
}
function photograph(value) {
  if (typeof value !== 'string') throw new Error('Profile photo must be an uploaded image.');
  if (!value) return '';
  if (value.length > CONTENT_LIMITS.photo) throw new Error('Each profile photo must be smaller than 350 KB after encoding.');
  if (!/^data:image\/(?:jpeg|png|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Use an uploaded JPG, PNG, or WebP image for the profile photo.');
  if (value.endsWith(',')) throw new Error('Profile photo is empty.');
  return value;
}
function emailAddress(value, label, optional = false) {
  if (typeof value !== 'string' || /[\r\n\x00]/.test(value)) throw new Error(`${label} must be a valid email address.`);
  const result = text(value, label, 254, optional);
  if (!result && optional) return '';
  if (!/^[^\s@<>()"\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(result) || result.split('@')[0].length > 64) throw new Error(`${label} must be a valid email address.`);
  return result;
}
function discordInvite(value) {
  const result = text(value, 'Discord server invite', 200, true);
  if (result && !/^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9_-]{2,100}\/?$/.test(result)) throw new Error('Use a discord.gg or discord.com/invite server invitation link.');
  return result;
}
function socialProfile(value, platform) {
  const label = platform === 'instagram' ? 'Instagram' : 'Facebook';
  const result = text(value === undefined ? '' : value, `${label} profile link`, 500, true);
  if (!result) return '';
  const invalid = () => new Error(`Use a full https://${platform}.com profile or page link, or leave it blank.`);
  if (/[\s\\\x00-\x1f\x7f]/.test(result)) throw invalid();
  let url;
  try { url = new URL(result); } catch { throw invalid(); }
  const hosts = platform === 'instagram' ? ['instagram.com', 'www.instagram.com'] : ['facebook.com', 'www.facebook.com', 'm.facebook.com'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port) throw invalid();
  const path = url.pathname;
  if (platform === 'instagram') {
    if (!/^\/[A-Za-z0-9._]{1,30}\/?$/.test(path) || /^\/(?:accounts|explore|direct|p|reel|reels|stories|about|developer|legal|privacy|web)\/?$/i.test(path)) throw invalid();
    url.search = '';
  } else if (path === '/profile.php') {
    const id = url.searchParams.get('id');
    if (!id || !/^\d{3,30}$/.test(id)) throw invalid();
    url.search = `?id=${id}`;
  } else {
    if (!/^\/(?:[A-Za-z0-9.]{2,100}\/?|(?:people|pages)\/[A-Za-z0-9._-]{1,150}\/\d{3,30}\/?)$/.test(path) || /^\/(?:l.php|login|login.php|logout.php|dialog|share|sharer|sharer.php|watch|reel|reels|photo|photos|help|privacy|policies|marketplace|gaming|groups|events|settings|people|pages)\/?$/i.test(path)) throw invalid();
    url.search = '';
  }
  url.hash = '';
  return url.href;
}
function community(value) {
  const result = section(value, communityFields, 'Community');
  result.discordInvite = discordInvite(value.discordInvite);
  result.email = emailAddress(value.email, 'Community email');
  result.instagram = socialProfile(value.instagram, 'instagram');
  result.facebook = socialProfile(value.facebook, 'facebook');
  return result;
}
function externalWebsite(value, label) {
  const result = text(value === undefined ? '' : value, label, 1000, true);
  if (!result) return '';
  const invalid = () => new Error(`${label} must be a full HTTPS link without a username or password.`);
  if (/[\s\\\x00-\x1f\x7f]/.test(result)) throw invalid();
  let url;
  try { url = new URL(result); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password || url.port) throw invalid();
  return url.href;
}
function schools(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > CONTENT_LIMITS.schools) throw new Error('Keep no more than 30 school partnerships.');
  const ids = new Set();
  return value.map((school, index) => {
    object(school, `School ${index + 1}`);
    if (typeof school.id !== 'string' || !/^[a-z][a-z0-9-]{0,49}$/.test(school.id) || ids.has(school.id) || ['__proto__', 'constructor', 'prototype'].includes(school.id)) throw new Error(`School ${index + 1} needs a unique valid ID.`);
    ids.add(school.id);
    return {
      id: school.id,
      name: text(school.name, `School ${index + 1} name`, 160),
      location: text(school.location === undefined ? '' : school.location, `School ${index + 1} location`, 160, true),
      grades: text(school.grades === undefined ? '' : school.grades, `School ${index + 1} grades`, 100, true),
      description: text(school.description === undefined ? '' : school.description, `School ${index + 1} description`, 1000, true),
      website: externalWebsite(school.website, `School ${index + 1} website`)
    };
  });
}
function donation(value) {
  if (value === undefined) return { url: '' };
  object(value, 'Donation settings');
  return { url: externalWebsite(value.url, 'Donation link') };
}
export function validateSiteContent(value) {
  object(value, 'Site content');
  if (value.version !== 1) throw new Error('Choose a version 1 BTS site content file.');
  if (!Array.isArray(value.people) || value.people.length > CONTENT_LIMITS.people) throw new Error('Keep no more than 20 staff profiles.');
  const ids = new Set();
  const result = {
    version: 1,
    home: section(value.home, homeFields, 'Homepage'),
    team: section(value.team, teamFields, 'Team page', ['titleAccent']),
    community: community(value.community === undefined ? COMMUNITY_DEFAULTS : value.community),
    schools: schools(value.schools),
    donation: donation(value.donation),
    people: value.people.map((person, index) => {
      object(person, `Profile ${index + 1}`);
      if (typeof person.id !== 'string' || !/^[a-z][a-z0-9-]{0,49}$/.test(person.id) || ids.has(person.id) || ['__proto__', 'constructor', 'prototype'].includes(person.id)) throw new Error(`Profile ${index + 1} needs a unique valid ID.`);
      ids.add(person.id);
      if (typeof person.visible !== 'boolean' || typeof person.placeholder !== 'boolean') throw new Error(`Profile ${index + 1} needs visibility and placeholder settings.`);
      const discord = text(person.discord === undefined ? '' : person.discord, `Profile ${index + 1} Discord username`, 80, true);
      if (/[\x00-\x1f\x7f]/.test(discord)) throw new Error(`Profile ${index + 1} Discord username must fit on one line.`);
      return {
        id: person.id,
        name: text(person.name, `Profile ${index + 1} name`, 100),
        role: text(person.role, `Profile ${index + 1} role`, 120),
        bio: text(person.bio, `Profile ${index + 1} biography`, 1500, true),
        photo: photograph(person.photo),
        photoAlt: text(person.photoAlt, `Profile ${index + 1} image description`, 200, true),
        discord,
        email: emailAddress(person.email === undefined ? '' : person.email, `Profile ${index + 1} email`, true),
        visible: person.visible,
        placeholder: person.placeholder
      };
    })
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > CONTENT_LIMITS.document) throw new Error('This content file is too large. Use smaller profile photos.');
  return result;
}
