import { validateSiteContent, CONTENT_LIMITS, CALENDAR_CATEGORIES } from './content-schema.js?v=calendar-14';
import { editProfilePhoto } from './photo-cropper.js?v=photo-10';

const DRAFT_KEY = 'bts-site-draft-v1';
const WEBSITE_BASE = new URL('../', import.meta.url);
const STATIC_PREVIEW = /(?:\.github\.io|\.chatgpt\.site)$/.test(location.hostname) || ['localhost','127.0.0.1','[::1]'].includes(location.hostname) || location.protocol === 'file:';
const $ = selector => document.querySelector(selector);
const clone = value => JSON.parse(JSON.stringify(value));
const state = { content: null, published: null, baseRevision: 0, serverRevision: 0, savedAt: null, dirty: false, hasDraft: false, authenticated: false, canPublish: false, loading: false, selectedPerson: null, selectedEvent: null, analyticsConfigured: false, photoBusy: false, ownerComplete: false, reconnecting: false };
const INCOMPLETE_DRAFT_MESSAGE = 'This draft may not include hidden profiles or calendar events. Export it, reload the complete owner content in Settings, and reapply your edits before publishing.';
function restoreDraft(value, serverRevision) {
  const envelope = value && typeof value === 'object' && Object.hasOwn(value, 'content');
  const content = validateSiteContent(envelope ? value.content : value);
  const suppliedRevision = envelope ? value.baseRevision : serverRevision;
  if (suppliedRevision !== undefined && (!Number.isInteger(suppliedRevision) || suppliedRevision < 0)) throw new Error('This draft has an invalid published revision.');
  const baseRevision = suppliedRevision === undefined ? 0 : suppliedRevision;
  const ownerComplete = envelope && typeof value.ownerComplete === 'boolean' ? value.ownerComplete : baseRevision === 0 && serverRevision === 0;
  return { content, baseRevision, ownerComplete, savedAt: envelope && typeof value.savedAt === 'string' ? value.savedAt : null };
}
function draftEnvelope(content = state.content, savedAt = state.savedAt) { return { content, baseRevision: state.baseRevision, ownerComplete: state.ownerComplete, savedAt }; }
const sectionNames = { overview: 'Overview', content: 'Site content', people: 'Team profiles', schools: 'Schools served', calendar: 'Calendar', applications: 'Applications', tutoring: 'Tutoring requests', traffic: 'Traffic stats', settings: 'Settings' };
const contentGroups = [
  ['Homepage introduction', 'The first words visitors see.', [['home.headline','Headline',160],['home.headlineAccent','Second headline line',160],['home.description','Introduction',2000,true]]],
  ['Curriculum', 'Introduce math and science learning at each grade.', [['home.curriculumTitle','Heading',160],['home.curriculumAccent','Second heading line',160],['home.curriculumIntro','Curriculum description',2000,true]]],
  ['Our approach', 'Explain the purpose behind Breaking the Sky.', [['home.aboutTitle','Heading',160],['home.aboutAccent','Second heading line',160],['home.aboutText','About BTS',2000,true]]],
  ['1-on-1 tutoring', 'Help students understand the support available.', [['home.tutoringTitle','Heading',160],['home.tutoringAccent','Second heading line',160],['home.tutoringIntro','Tutoring introduction',2000,true]]],
  ['Contact', 'A clear invitation to get in touch.', [['home.contactIntro','Contact introduction',2000,true]]],
  ['Community', 'Add a Discord invitation and the public community email address.', [['community.name','Community name',100],['community.description','Community introduction',1000,true],['community.discordInvite','Discord server invite (optional)',200,false,true],['community.email','Public contact email',254]]],
  ['Social media', 'Add your BTS profiles to the Community page and website footer. Leave a link blank until the account is ready.', [['community.instagram','Instagram profile link (optional)',500,false,true],['community.facebook','Facebook page or profile link (optional)',500,false,true]]],
  ['Donations', 'Add the HTTPS link to your organization’s donation provider. Leave it blank until you are ready to accept donations.', [['donation.url','Donation link (optional)',1000,false,true]]],
  ['Team page', 'Set the scene before visitors meet your people.', [['team.title','Heading',160],['team.titleAccent','Second heading line (optional)',160,false,true],['team.intro','Team introduction',2000,true],['team.sectionIntro','Introduction above profiles',2000,true]]]
];

function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function status(message, error = false) { $('#owner-status').textContent = message; $('#owner-status').classList.toggle('is-error', error); }
function formatSaved(value) { try { return new Intl.DateTimeFormat(undefined, { month:'short',day:'numeric',hour:'numeric',minute:'2-digit' }).format(new Date(value)); } catch { return 'recently'; } }
function getPath(value, path) { const [group,key] = path.split('.'); return value[group]?.[key] || ''; }
function setPath(path, value) { const [group,key] = path.split('.'); state.content[group][key] = value; }
function markDirty() { state.dirty = true; updateDraftState(); }
function updateDraftState() {
  $('#draft-state').textContent = state.reconnecting ? 'Checking owner connection…' : state.loading ? 'Publishing your changes…' : state.dirty ? 'Unsaved changes on this page' : state.hasDraft ? `Draft saved on this device${state.savedAt ? ' · '+formatSaved(state.savedAt) : ''}` : 'Viewing the published content';
  $('#publish-content').disabled = !state.canPublish || !state.ownerComplete || state.loading || state.photoBusy || !state.content;
  $('#publish-content').title = !state.canPublish ? 'Reconnect owner access to publish your saved draft' : !state.ownerComplete ? INCOMPLETE_DRAFT_MESSAGE : 'Publish these changes to the live website';
}
function activatePanel(name, focus = true) {
  if (!sectionNames[name]) name = 'overview';
  document.querySelectorAll('.owner-panel').forEach(el => { el.hidden = el.id !== 'panel-'+name; });
  document.querySelectorAll('[data-panel]').forEach(el => { if (el.dataset.panel === name) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
  $('#current-section').textContent = sectionNames[name];
  history.replaceState(null, '', '#panel-'+name);
  if (focus) $('#heading-'+name).focus({preventScroll:true});
}
function connectionError(message, code, status = 0) { const error = new Error(message); error.code = code; error.status = status; return error; }
async function request(path, options = {}) {
  const url = new URL(path, WEBSITE_BASE);
  const privateRequest = path.startsWith('api/owner/');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { Accept: 'application/json', ...options.headers }, ...(privateRequest ? { redirect: 'manual' } : {}), signal: controller.signal });
    if (privateRequest && (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400))) throw connectionError('Sign in through Cloudflare to reconnect your owner session.', 'sign_in_required', 401);
    let data; try { data = await response.json(); } catch { data = null; }
    if (privateRequest && response.ok && !data) throw connectionError('Sign in through Cloudflare to reconnect your owner session.', 'sign_in_required', 401);
    if (!response.ok || !data) throw connectionError(data?.error || data?.reason || 'The owner connection could not be checked right now.', data?.code || 'connection_unavailable', response.status);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw connectionError('The connection timed out. Your draft is still on this device.', 'request_timeout');
    if (typeof error.code === 'string' && error.status !== undefined) throw error;
    throw connectionError('The website could not be reached. Your draft is still on this device.', 'network_unavailable');
  } finally { clearTimeout(timeout); }
}
function avatar(person, className = 'owner-avatar') {
  const wrap = node('div',className);
  if (person.photo) { const img = node('img'); img.src = person.photo; img.alt = ''; wrap.append(img); }
  else wrap.textContent = person.placeholder ? '✳' : (person.name.trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('') || 'BTS');
  return wrap;
}
function renderOverview() {
  const people = state.content.people; const visible = people.filter(person=>person.visible);
  $('#profile-count').textContent = String(people.length);
  $('#profile-count-note').textContent = `${visible.length} visible · ${people.filter(person=>person.placeholder).length} placeholder${people.filter(person=>person.placeholder).length===1?'':'s'}`;
  const container = $('#team-overview'); container.replaceChildren();
  people.slice(0,4).forEach(person=>{ const row=node('div','owner-team-row'); const text=node('div');text.append(node('strong','',person.name),node('small','',person.role));row.append(avatar(person),text); if(!person.visible || person.placeholder)row.append(node('span','owner-person-badge',!person.visible?'Hidden':'Placeholder'));container.append(row); });
  if(!people.length)container.append(node('p','owner-card-footnote','No profiles yet. Add your first team member.'));
  const questions = window.BTSApplication?.defaultConfig?.fields;
  $('#question-count').textContent = Array.isArray(questions) ? String(questions.length) : '—';
}
function renderContentFields() {
  const container = $('#content-fields'); container.replaceChildren();
  contentGroups.forEach(([heading,description,fields])=>{
    const group=node('section','owner-content-group');group.append(node('h2','',heading),node('p','',description)); const grid=node('div','owner-field-grid');
    fields.forEach(([path,label,limit,multiline,optional])=>{
      const field=node('label','owner-field'+(multiline?' full-width':''),label); const input=node(multiline?'textarea':'input');input.id='edit-'+path.replace('.','-');input.dataset.contentPath=path;input.value=getPath(state.content,path);input.maxLength=limit;input.required=!optional;
      if(multiline)input.rows=4;else input.type=path==='community.email'?'email':['community.discordInvite','community.instagram','community.facebook','donation.url'].includes(path)?'url':'text';field.htmlFor=input.id;field.append(input);if(path==='community.instagram')input.placeholder='https://www.instagram.com/your-account/';if(path==='community.facebook')input.placeholder='https://www.facebook.com/your-page/';grid.append(field);
    }); group.append(grid);container.append(group);
  });
}
function renderPeopleList() {
  const container=$('#people-list');container.replaceChildren();
  state.content.people.forEach(person=>{const button=node('button','owner-person-selector');button.type='button';button.dataset.personId=person.id;button.setAttribute('aria-pressed',String(person.id===state.selectedPerson));const text=node('span','owner-person-text');text.append(node('strong','',person.name||'Untitled profile'),node('small','',person.role||'Role'));if(!person.visible||person.placeholder)text.append(node('span','owner-person-badge',!person.visible?'Hidden from website':'Placeholder'));button.append(avatar(person),text);container.append(button);});
  $('#add-person').disabled=state.content.people.length>=20 || state.loading;
  if(!state.content.people.length)container.append(node('p','owner-card-footnote','Your team starts here. Add a profile to get going.'));
}
function currentPerson() { return state.content.people.find(person=>person.id===state.selectedPerson); }
function renderPersonPreview() {
  const container=$('#person-preview');container.replaceChildren();const person=currentPerson();if(!person)return;
  container.append(avatar(person,'owner-preview-photo'),node('h3','',person.name||'Your team member'),node('p','owner-preview-role',person.role||'Their role'),node('p','owner-preview-bio',person.bio||'Their story goes here.'));
  const socials=node('div','owner-profile-socials');for(const [key,icon] of [['discord','discord'],['email','gmail']]){if(!person[key])continue;const item=node('span');const image=node('img');image.src='assets/icon-'+icon+'.svg';image.alt='';item.append(image,node('span','',person[key]));socials.append(item);}if(socials.children.length)container.append(socials);
  if(!person.visible)container.append(node('p','owner-preview-hidden','This profile is hidden from the published team page.'));
  else if(person.placeholder)container.append(node('p','owner-preview-hidden','Marked as a placeholder until you’re ready to introduce this person.'));
}
function renderPersonEditor() {
  const container=$('#person-editor');container.replaceChildren();const person=currentPerson();
  if(!person){container.append(node('h2','','Introduce your first person.'),node('p','','Add a team member to start editing their profile.'));renderPersonPreview();return;}
  const index=state.content.people.indexOf(person);const actions=node('div','owner-person-actions');const ordering=node('div');
  [['up','↑','Move profile up',index===0],['down','↓','Move profile down',index===state.content.people.length-1]].forEach(([action,text,label,disabled])=>{const button=node('button','owner-order-button',text);button.type='button';button.dataset.personAction=action;button.setAttribute('aria-label',label);button.disabled=disabled;ordering.append(button);});
  const remove=node('button','owner-danger','Remove profile');remove.type='button';remove.dataset.personAction='remove';actions.append(ordering,remove);container.append(actions);
  const form=node('div','owner-person-form');
  [['name','Full name',100],['role','Role',120],['bio','Short bio',1500,true],['photoAlt','Photo description',200],['discord','Discord username (optional)',80],['email','Public email (optional)',254]].forEach(([key,label,max,multiline])=>{const field=node('label','owner-field',label);const input=node(multiline?'textarea':'input');input.id='person-'+key;input.dataset.personField=key;input.value=person[key]||'';input.maxLength=max;input.required=key==='name'||key==='role';if(multiline)input.rows=5;else input.type=key==='email'?'email':'text';field.htmlFor=input.id;field.append(input);if(key==='bio')field.append(node('small','','A few sentences about their background, interests, and work with BTS.'));if(key==='photoAlt')field.append(node('small','','Describe the photo for people using a screen reader.'));if(key==='email'||key==='discord')field.append(node('small','','Shown publicly when this profile is visible.'));form.append(field);});
  [['visible','Show this profile on the team page'],['placeholder','Mark this profile as a placeholder']].forEach(([key,label])=>{const field=node('label','owner-profile-check');const input=node('input');input.type='checkbox';input.dataset.personField=key;input.checked=person[key];field.append(input,node('span','',label));form.append(field);});
  const photos=node('div','owner-photo-controls');photos.append(node('strong','','Profile photo'));const upload=node('input');upload.id='person-photo';upload.type='file';upload.accept='image/jpeg,image/png,image/webp';upload.setAttribute('aria-label','Upload a photo for '+person.name);photos.append(upload,node('p','','JPG, PNG, or WebP · Up to 10 MB. Crop, zoom, and position your photo before applying it.'));
  const cropPhoto=node('button','owner-secondary','Crop / adjust photo');cropPhoto.type='button';cropPhoto.dataset.personAction='crop-photo';cropPhoto.disabled=!person.photo;photos.append(cropPhoto);
  const removePhoto=node('button','owner-inline-button','Remove photo');removePhoto.type='button';removePhoto.dataset.personAction='remove-photo';removePhoto.disabled=!person.photo;photos.append(removePhoto);form.append(photos);container.append(form);renderPersonPreview();
}
function renderSchools() {
  const container = $('#school-fields'); container.replaceChildren();
  const schools = state.content.schools;
  $('#add-school').disabled = schools.length >= 30 || state.loading || state.photoBusy;
  if (!schools.length) container.append(node('p', 'owner-card owner-school-empty', 'No schools added yet. Add the schools BTS currently works with when you’re ready to share them.'));
  schools.forEach((school, index) => {
    const card = node('section', 'owner-content-group owner-school-editor'); card.dataset.schoolId = school.id;
    const heading = node('div', 'owner-school-heading');
    const title = node('h3', '', school.name || 'New school'); title.dataset.schoolTitle = school.id;
    const remove = node('button', 'owner-danger', 'Remove'); remove.type = 'button'; remove.dataset.removeSchool = school.id; remove.setAttribute('aria-label', 'Remove ' + (school.name || 'new school'));
    heading.append(title, remove); card.append(heading);
    const fields = node('div', 'owner-field-grid');
    for (const [key, label, maximum, multiline] of [['name','School name',160],['location','City / area (optional)',160],['grades','Grades served (optional)',100],['website','School website (optional)',1000],['description','About this partnership (optional)',1000,true]]) {
      const field = node('label', 'owner-field' + (multiline ? ' full-width' : ''), label);
      const input = node(multiline ? 'textarea' : 'input'); input.id = `school-${school.id}-${key}`; input.dataset.schoolField = key; input.value = school[key]; input.maxLength = maximum; input.required = key === 'name';
      if (multiline) input.rows = 3; else input.type = key === 'website' ? 'url' : 'text';
      field.htmlFor = input.id; field.append(input); fields.append(field);
    }
    card.append(fields); container.append(card);
  });
}
const calendarCategoryNames = { school: 'School visit', tutoring: 'Tutoring', volunteer: 'Volunteer', community: 'Community', other: 'Other' };
function currentCalendarEvent() { return state.content?.calendar.events.find(event => event.id === state.selectedEvent); }
function renderCalendarList() {
  const calendar = state.content.calendar;
  const events = calendar.events;
  const container = $('#calendar-event-list'); container.replaceChildren();
  $('#add-calendar-event').disabled = events.length >= CONTENT_LIMITS.calendarEvents || state.loading || state.photoBusy;
  $('#calendar-event-count').textContent = `${events.length} event${events.length === 1 ? '' : 's'} · ${events.filter(event => event.visible).length} visible on the calendar`;
  if (!events.length) container.append(node('p', 'owner-card-footnote', 'No events yet. Add a school visit, tutoring session, or community event when you’re ready.'));
  for (const event of events) {
    const button = node('button', 'owner-calendar-selector'); button.type = 'button'; button.dataset.calendarEventId = event.id;
    button.setAttribute('aria-pressed', String(event.id === state.selectedEvent));
    button.append(node('strong', '', event.title || 'Untitled event'), node('span', '', event.date || 'Choose a date'));
    const detail = node('small', '', [calendarCategoryNames[event.category] || 'Other', event.startTime || 'All day', event.visible ? 'Visible' : 'Hidden'].join(' · '));
    button.append(detail); container.append(button);
  }
}
function renderCalendarEditor() {
  const container = $('#calendar-event-editor'); container.replaceChildren();
  const event = currentCalendarEvent();
  if (!event) { container.append(node('h3', '', 'Plan your next event.'), node('p', 'owner-card-footnote', 'Add an event to set its date, time, location, and details.')); return; }
  const heading = node('div', 'owner-calendar-editor-heading'); heading.append(node('h3', '', 'Event details'));
  const remove = node('button', 'owner-danger', 'Remove event'); remove.type = 'button'; remove.dataset.calendarAction = 'remove'; heading.append(remove); container.append(heading);
  const fields = node('div', 'owner-field-grid');
  const definitions = [['title', 'Event title', 'text', 160, true], ['date', 'Date', 'date', 10, true], ['startTime', 'Start time (optional)', 'time', 5], ['endTime', 'End time (optional)', 'time', 5], ['location', 'Location or meeting details (optional)', 'text', 250], ['url', 'More information / registration link (optional)', 'url', 1000], ['description', 'Description (optional)', 'textarea', 2000]];
  for (const [key, label, type, maximum, required] of definitions) {
    const field = node('label', 'owner-field' + (key === 'description' || key === 'title' ? ' full-width' : ''), label);
    const input = node(type === 'textarea' ? 'textarea' : 'input'); input.id = `calendar-event-${key}`; input.dataset.calendarField = key; input.value = event[key]; input.maxLength = maximum; input.required = Boolean(required);
    if (type === 'textarea') input.rows = 5; else input.type = type;
    // Set values after the native input type so browsers retain supported date/time values.
    input.value = event[key];
    if (type === 'date') { input.min = '2000-01-01'; input.max = '2199-12-31'; }
    if (type === 'time') input.step = '60';
    if (key === 'url') input.placeholder = 'https://';
    field.htmlFor = input.id; field.append(input); fields.append(field);
  }
  const category = node('label', 'owner-field', 'Event type');
  const select = node('select'); select.id = 'calendar-event-category'; select.dataset.calendarField = 'category';
  for (const value of CALENDAR_CATEGORIES) { const option = node('option', '', calendarCategoryNames[value]); option.value = value; select.append(option); }
  select.value = event.category; category.htmlFor = select.id; category.append(select); fields.append(category);
  const visibility = node('label', 'owner-profile-check owner-calendar-visibility'); const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.id = 'calendar-event-visible'; checkbox.dataset.calendarField = 'visible'; checkbox.checked = event.visible; visibility.append(checkbox, node('span', '', 'Show this event on the public calendar')); fields.append(visibility);
  container.append(fields);
  const timeHelp = node('p', 'owner-card-footnote', 'Leave both times blank for an all-day event. An end time needs a start time and must be later on the same day. All times use the calendar’s time zone.');
  const allDay = node('button', 'owner-inline-button', 'Clear times / make all-day'); allDay.type = 'button'; allDay.dataset.calendarAction = 'all-day';
  container.append(timeHelp, allDay, node('p', 'owner-card-footnote', 'Save your draft and preview the calendar before publishing. Hidden events stay available here for editing.'));
}
function renderCalendar() {
  const calendar = state.content.calendar;
  if (!calendar.events.some(event => event.id === state.selectedEvent)) state.selectedEvent = calendar.events[0]?.id || null;
  $('#calendar-time-zone').value = calendar.timeZone;
  renderCalendarList(); renderCalendarEditor();
}
function renderAll() { renderContentFields();renderOverview();renderPeopleList();renderPersonEditor();renderSchools();renderCalendar();updateDraftState(); }

function saveDraft(showMessage = true) {
  try { const content=validateSiteContent(state.content);const savedAt=new Date().toISOString();localStorage.setItem(DRAFT_KEY,JSON.stringify(draftEnvelope(content,savedAt)));state.content=content;state.savedAt=savedAt;state.hasDraft=true;state.dirty=false;updateDraftState();if(showMessage)status(state.ownerComplete?'Draft saved on this device. Visitors still see the published website.':INCOMPLETE_DRAFT_MESSAGE,!state.ownerComplete);return true; }
  catch(error){status(error.name==='QuotaExceededError'?'This device doesn’t have enough space to save the draft. Remove a large photo or export a copy to keep your work.':error.message||'Could not save this draft. Export a copy to keep your work.',true);return false;}
}
function exportDraft() {
  if(state.loading||state.photoBusy)return;
  try {const content=validateSiteContent(state.content);const blob=new Blob([JSON.stringify(draftEnvelope(content,new Date().toISOString()),null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const link=node('a');link.href=url;link.download='bts-site-content.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Draft exported. Share the file in our chat to publish before Cloudflare is connected.');}catch(error){status(error.message,true);}
}
async function adjustPhoto(source, personId, existing = false) {
  if (!source || state.loading || state.photoBusy) return;
  const focusBefore = document.activeElement;
  state.photoBusy = true; updateDraftState(); lockEditors(true);
  status(existing ? 'Adjust the photo, then apply your crop.' : 'Preparing your photo editor…');
  let applied = false;
  try {
    const photo = await editProfilePhoto(source, { existing });
    if (!photo) { status('Photo unchanged.'); return; }
    const person = state.content.people.find(person => person.id === personId);
    if (!person) return;
    const next = clone(state.content);
    const edited = next.people.find(person => person.id === personId);
    edited.photo = photo;
    if (!edited.photoAlt) edited.photoAlt = 'Portrait of ' + edited.name;
    validateSiteContent(next);
    person.photo = edited.photo; person.photoAlt = edited.photoAlt;
    markDirty(); renderPeopleList(); renderPersonEditor(); renderOverview(); applied = true;
    status('Photo crop applied to your draft. Save your draft when you’re ready.');
  } catch (error) { status(error.message || 'The photo could not be adjusted. Your previous photo is unchanged.', true); }
  finally {
    state.photoBusy = false; lockEditors(false); updateDraftState();
    const picker = $('#person-photo'); if (picker) picker.value = '';
    if (applied) document.querySelector('[data-person-action="crop-photo"]')?.focus({ preventScroll: true });
    else if (focusBefore?.isConnected) focusBefore.focus({ preventScroll: true });
  }
}
function connectionDescription(error, fallback) {
  if (error?.code === 'identity_unavailable') return 'Cloudflare sign-in verification is temporarily unavailable. Your draft is safe. Reconnect to try again.';
  if (error?.code === 'request_timeout') return 'The connection timed out. Your draft is safe. Reconnect to try again.';
  if (error?.code === 'network_unavailable') return 'The website could not be reached. Your draft is safe. Reconnect when the connection is available.';
  return (error?.message || fallback) + ' Your draft remains on this device.';
}
function applyConnection(session, ownerContent, sessionError, ownerContentError) {
  state.authenticated = Boolean(session?.owner); state.canPublish = Boolean(session?.owner && ownerContent); state.analyticsConfigured = Boolean(session?.analyticsConfigured);
  // Start from a known state so reconnect failures never leave stale "connected" labels.
  $('#connection-heading').textContent = 'Draft workspace';
  $('#connection-description').textContent = 'This preview saves drafts on this device. Open the hosted website to sign in and publish.';
  $('#sidebar-mode').textContent = 'Draft workspace'; $('#sidebar-mode-help').textContent = 'Drafts stay on this device.';
  $('#settings-mode').textContent = 'Drafts on this device'; $('#settings-auth').textContent = 'Not connected'; $('#settings-publishing').textContent = 'Not connected';
  $('#settings-explanation').textContent = 'This preview has no access to publish website changes. Your local drafts are preserved.';
  $('#owner-signin').hidden = true; $('#connection-signin').hidden = true; $('#reconnect-owner').hidden = STATIC_PREVIEW;
  const signInUrl = new URL('owner', WEBSITE_BASE); signInUrl.searchParams.set('signin', '1'); signInUrl.hash = location.hash;
  $('#owner-signin').href = signInUrl.href; $('#connection-signin').href = signInUrl.href;
  if (state.canPublish) {
    $('#connection-heading').textContent = 'Owner connected'; $('#connection-description').textContent = 'Save a draft, preview your changes, then publish them to the website. Only the approved owner can publish.';
    $('#sidebar-mode').textContent = 'Owner connected'; $('#sidebar-mode-help').textContent = session.email;
    $('#settings-mode').textContent = 'Owner publishing'; $('#settings-auth').textContent = session.email; $('#settings-publishing').textContent = 'Connected';
    $('#settings-explanation').textContent = 'Owner access is verified by Cloudflare. Publish changes makes this draft visible on the website.';
  } else if (state.authenticated) {
    $('#connection-heading').textContent = 'Website content unavailable';
    $('#connection-description').textContent = connectionDescription(ownerContentError, 'Owner sign-in is verified, but the website content could not be loaded.');
    $('#sidebar-mode').textContent = 'Connection needs attention'; $('#settings-auth').textContent = session.email; $('#settings-publishing').textContent = 'Content unavailable';
    $('#settings-explanation').textContent = $('#connection-description').textContent;
    if (!STATIC_PREVIEW) { $('#owner-signin').hidden = false; $('#connection-signin').hidden = false; }
  } else if (!STATIC_PREVIEW) {
    const needsSignIn = sessionError?.status === 401 || sessionError?.status === 403 || sessionError?.code === 'sign_in_required';
    $('#connection-heading').textContent = needsSignIn ? 'Owner sign-in required' : sessionError?.code === 'identity_unavailable' ? 'Couldn’t verify owner sign-in' : 'Owner connection unavailable';
    $('#connection-description').textContent = needsSignIn ? connectionDescription(sessionError, 'Sign in as an approved owner to publish changes.') : connectionDescription(sessionError, 'The owner connection could not be checked right now.');
    $('#sidebar-mode').textContent = needsSignIn ? 'Sign-in required' : 'Connection needs attention';
    $('#settings-auth').textContent = needsSignIn ? 'Sign-in required' : 'Verification unavailable'; $('#settings-publishing').textContent = 'Connection required';
    $('#settings-explanation').textContent = $('#connection-description').textContent;
    $('#owner-signin').hidden = false; $('#connection-signin').hidden = false;
  }
  $('#settings-analytics').textContent = state.analyticsConfigured ? 'Configured' : 'Not connected'; $('#refresh-stats').disabled = !state.authenticated;
  if (!state.authenticated) { statsRequestId++; $('#stats-connected').hidden = true; $('#stats-unconnected').hidden = false; $('#overview-pageviews').textContent = '—'; $('#overview-traffic-note').textContent = STATIC_PREVIEW ? 'Available on the hosted website' : 'Reconnect to view page views'; }
  updateDraftState();
}
function numeric(value) { return Number.isFinite(value)&&value>=0?value:null; }
function numberText(value) { return numeric(value)===null?'—':new Intl.NumberFormat().format(value); }
function byteText(value) {if(numeric(value)===null)return'—';if(value<1024)return value+' B';const units=['KB','MB','GB','TB'];let n=value/1024,index=0;while(n>=1024&&index<units.length-1){n/=1024;index++;}return new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n)+' '+units[index];}
let statsRequestId = 0;
const statsPageNames = { '/': 'Home', '/curriculum': 'Curriculum', '/team': 'Our people', '/tutoring': '1-on-1 tutoring', '/community': 'Community', '/contact': 'Contact us', '/apply': 'Volunteer application', '/schools': 'Schools we serve', '/sponsors': 'Sponsors', '/donate': 'Donate', '/calendar': 'Calendar' };
function statsDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}
function renderStats(result, days) {
  if (!result.totals || !Array.isArray(result.daily)) throw new Error('Traffic data is unavailable.');
  const site = result.provider === 'site';
  if (site && !Array.isArray(result.pages)) throw new Error('Page data is unavailable.');
  $('#stats-connected').hidden = false; $('#stats-unconnected').hidden = true;
  $('#stats-pageviews').textContent = numberText(result.totals.pageViews);
  $('#stats-requests').textContent = numberText(site ? result.totals.applications : result.totals.requests);
  $('#stats-bytes').textContent = site ? numberText(result.totals.activePages) : byteText(result.totals.bytes);
  $('#stats-views-note').textContent = site ? 'Recorded public page loads' : 'Pages requested in this period';
  $('#stats-secondary-label').textContent = site ? 'Applications' : 'Requests';
  $('#stats-secondary-note').textContent = site ? 'Applications submitted in this period' : 'All requests, including assets';
  $('#stats-third-label').textContent = site ? 'Pages viewed' : 'Bandwidth';
  $('#stats-third-note').textContent = site ? 'Different pages with recorded views' : 'Data served by Cloudflare';
  $('#overview-pageviews').textContent = numberText(result.totals.pageViews);
  $('#overview-traffic-note').textContent = site ? 'Last ' + days + ' days · Includes today (UTC)' : 'Last ' + days + ' complete days · Cloudflare';
  $('#stats-updated').textContent = result.updatedAt ? 'Updated ' + formatSaved(result.updatedAt) : '';
  const start = statsDate(result.period?.start), end = statsDate(result.period?.end);
  $('#stats-period').textContent = site
    ? 'BTS website page views · ' + (start && end ? start + '–' + end + ', including today (UTC).' : 'Last ' + days + ' calendar days, including today (UTC).') + ' Counts begin after the website connection.'
    : 'Cloudflare zone traffic · Complete UTC days. Unique IPs indicate approximate reach, not confirmed individual visitors.';
  $('#stats-caption').textContent = site ? 'Daily BTS page views and applications, including today in UTC.' : 'Daily Cloudflare zone traffic. Unique IP addresses are counted separately each day.';
  $('#stats-days').querySelectorAll('option').forEach(option => { option.textContent = 'Last ' + option.value + (site ? ' days, including today' : ' complete days'); });
  const columns = site ? ['Date', 'Page views', 'Applications'] : ['Date', 'Page views', 'Requests', 'Unique IPs'];
  $('#stats-columns').replaceChildren(...columns.map(title => { const th = node('th', '', title); th.scope = 'col'; return th; }));
  const rows = $('#stats-rows'); rows.replaceChildren();
  for (const day of result.daily) {
    const date = statsDate(day.date); if (!date) continue;
    const tr = node('tr'); tr.append(node('td', '', date), node('td', '', numberText(day.pageViews)), node('td', '', numberText(site ? day.applications : day.requests)));
    if (!site) tr.append(node('td', '', numberText(day.uniqueIPs)));
    rows.append(tr);
  }
  if (!rows.children.length) { const tr = node('tr'); const td = node('td', '', 'No daily records for this period.'); td.colSpan = columns.length; tr.append(td); rows.append(tr); }
  $('#stats-pages-card').hidden = !site;
  const pageRows = $('#stats-pages-rows'); pageRows.replaceChildren();
  if (site) {
    for (const page of result.pages) {
      if (!Object.hasOwn(statsPageNames, page.path)) continue;
      const tr = node('tr'); tr.append(node('td', '', statsPageNames[page.path]), node('td', '', numberText(page.pageViews))); pageRows.append(tr);
    }
    if (!pageRows.children.length) { const tr = node('tr'); const td = node('td', '', 'No page views recorded in this period yet.'); td.colSpan = 2; tr.append(td); pageRows.append(tr); }
    $('#settings-analytics').textContent = 'Recording website page views';
  } else $('#settings-analytics').textContent = 'Cloudflare zone analytics';
}
async function loadStats() {
  if (!state.authenticated) return;
  const requestId = ++statsRequestId; $('#refresh-stats').disabled = true; $('#refresh-stats').textContent = 'Refreshing…';
  try {
    const days = Number($('#stats-days').value); const result = await request('api/owner/stats?days=' + days); if (requestId !== statsRequestId) return;
    if (result.connected !== true) {
      $('#stats-connected').hidden = true; $('#stats-unconnected').hidden = false;
      $('#stats-empty-description').textContent = 'Page view reporting starts after the website database is connected.';
      $('#overview-pageviews').textContent = '—'; $('#overview-traffic-note').textContent = 'Page views not connected'; return;
    }
    renderStats(result, days);
  } catch {
    if (requestId !== statsRequestId) return;
    $('#stats-connected').hidden = true; $('#stats-unconnected').hidden = false;
    $('#stats-empty-description').textContent = 'Traffic data could not be loaded. Refresh to try again.';
    $('#overview-pageviews').textContent = '—'; $('#overview-traffic-note').textContent = 'Traffic temporarily unavailable';
  } finally { if (requestId === statsRequestId) { $('#refresh-stats').disabled = false; $('#refresh-stats').textContent = 'Refresh stats ↻'; } }
}
const disabledDuringPublish = new Map();
function lockEditors(locked) {
  if (locked) document.querySelectorAll('#owner-main input, #owner-main textarea, #owner-main select, #owner-main button').forEach(control=>{if(control.closest('#owner-applications-workspace'))return;disabledDuringPublish.set(control,control.disabled);control.disabled=true;});
  else {disabledDuringPublish.forEach((disabled,control)=>{control.disabled=disabled;});disabledDuringPublish.clear();}
}
async function publish() {
  if(!state.canPublish||state.loading||state.photoBusy)return;if(!state.ownerComplete){status(INCOMPLETE_DRAFT_MESSAGE,true);return;}if(!saveDraft(false))return;
  if(!confirm('Publish these website and team changes for everyone to see?'))return;
  state.loading=true;updateDraftState();lockEditors(true);status('Publishing your changes…');
  try {
    const result=await request('api/owner/publish',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({content:state.content,expectedRevision:state.baseRevision})});
    const content=validateSiteContent(result.content);if(!Number.isInteger(result.revision))throw new Error('The published version could not be verified.');
    state.content=clone(content);state.published=clone(content);state.serverRevision=result.revision;state.baseRevision=result.revision;state.ownerComplete=true;state.savedAt=null;state.hasDraft=false;state.dirty=false;try{localStorage.removeItem(DRAFT_KEY);}catch{}renderAll();status('Published. Your website and team profiles are now up to date.');
  } catch(error) {status(error.status===409?'The published website changed after this draft was started. Export your draft, then reload the latest published content before making a new version.':'Publishing could not be confirmed. Your draft is saved on this device. Please try again or export a copy.',true);}
  finally {state.loading=false;lockEditors(false);updateDraftState();}
}

// Navigation changes preserve all current edits.
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>activatePanel(button.dataset.panel)));
document.querySelectorAll('[data-open-panel]').forEach(button=>button.addEventListener('click',()=>activatePanel(button.dataset.openPanel)));
$('#site-content-form').addEventListener('submit',event=>event.preventDefault());
$('#content-fields').addEventListener('input',event=>{const path=event.target.dataset.contentPath;if(path){setPath(path,event.target.value);markDirty();}});
$('#school-fields').addEventListener('input',event=>{
  if (state.loading || state.photoBusy) return;
  const key = event.target.dataset.schoolField; const id = event.target.closest('[data-school-id]')?.dataset.schoolId;
  const school = state.content?.schools.find(item => item.id === id); if (!school || !['name','location','grades','website','description'].includes(key)) return;
  school[key] = event.target.value; markDirty();
  if (key === 'name') { event.target.closest('[data-school-id]').querySelector('[data-school-title]').textContent = school.name || 'New school'; event.target.closest('[data-school-id]').querySelector('[data-remove-school]').setAttribute('aria-label', 'Remove ' + (school.name || 'new school')); }
});
$('#school-fields').addEventListener('click',event=>{
  if (state.loading || state.photoBusy) return;
  const button = event.target.closest('[data-remove-school]'); if (!button) return;
  const school = state.content.schools.find(item => item.id === button.dataset.removeSchool); if (!school || !confirm('Remove ' + (school.name || 'this school') + ' from the draft?')) return;
  state.content.schools = state.content.schools.filter(item => item.id !== school.id); markDirty(); renderSchools(); $('#add-school').focus({preventScroll:true});
});
$('#add-school').addEventListener('click',()=>{
  if (!state.content || state.loading || state.photoBusy || state.content.schools.length >= 30) return;
  const id = 'school-' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0,24);
  state.content.schools.push({id,name:'',location:'',grades:'',description:'',website:''}); markDirty(); renderSchools(); document.getElementById(`school-${id}-name`).focus();
});
$('#calendar-time-zone').addEventListener('input',event=>{
  if (!state.content || state.loading || state.photoBusy) return;
  state.content.calendar.timeZone = event.target.value; markDirty();
});
$('#calendar-event-list').addEventListener('click',event=>{
  if (!state.content || state.loading || state.photoBusy) return;
  const button = event.target.closest('[data-calendar-event-id]'); if (!button) return;
  state.selectedEvent = button.dataset.calendarEventId; renderCalendarList(); renderCalendarEditor();
  $('#calendar-event-title')?.focus({preventScroll:true});
});
$('#calendar-event-editor').addEventListener('input',event=>{
  if (!state.content || state.loading || state.photoBusy) return;
  const key = event.target.dataset.calendarField; const item = currentCalendarEvent();
  if (!item || !['title','date','startTime','endTime','category','location','description','url','visible'].includes(key)) return;
  item[key] = key === 'visible' ? event.target.checked : event.target.value;
  markDirty(); renderCalendarList();
});
$('#calendar-event-editor').addEventListener('click',event=>{
  if (!state.content || state.loading || state.photoBusy) return;
  const button = event.target.closest('[data-calendar-action]'); const item = currentCalendarEvent(); if (!button || !item) return;
  if (button.dataset.calendarAction === 'remove') {
    if (!confirm('Remove ' + (item.title || 'this event') + ' from your calendar draft?')) return;
    const index = state.content.calendar.events.indexOf(item);
    state.content.calendar.events.splice(index, 1);
    state.selectedEvent = state.content.calendar.events[Math.min(index, state.content.calendar.events.length - 1)]?.id || null;
    markDirty(); renderCalendar();
    ($('#calendar-event-title') || $('#add-calendar-event')).focus({preventScroll:true});
  } else if (button.dataset.calendarAction === 'all-day') {
    item.startTime = ''; item.endTime = '';
    $('#calendar-event-startTime').value = ''; $('#calendar-event-endTime').value = '';
    markDirty(); renderCalendarList(); status('Event times cleared. This event is now all-day.');
  }
});
$('#add-calendar-event').addEventListener('click',()=>{
  if (!state.content || state.loading || state.photoBusy || state.content.calendar.events.length >= CONTENT_LIMITS.calendarEvents) return;
  const id = 'event-' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0,24);
  state.content.calendar.events.push({id,title:'',date:'',startTime:'',endTime:'',category:'other',location:'',description:'',url:'',visible:false});
  state.selectedEvent = id; markDirty(); renderCalendar(); $('#calendar-event-title').focus({preventScroll:true});
});
$('#people-list').addEventListener('click',event=>{const button=event.target.closest('[data-person-id]');if(!button)return;state.selectedPerson=button.dataset.personId;renderPeopleList();renderPersonEditor();});
$('#person-editor').addEventListener('input',event=>{const key=event.target.dataset.personField;const person=currentPerson();if(!key||!person)return;person[key]=event.target.type==='checkbox'?event.target.checked:event.target.value;markDirty();renderPeopleList();renderPersonPreview();renderOverview();});
$('#person-editor').addEventListener('change',event=>{if(event.target.id==='person-photo')adjustPhoto(event.target.files[0],state.selectedPerson);});
$('#person-editor').addEventListener('click',event=>{const button=event.target.closest('[data-person-action]');const person=currentPerson();if(!button||!person)return;const action=button.dataset.personAction;if(action==='crop-photo'){adjustPhoto(person.photo,person.id,true);return;}const index=state.content.people.indexOf(person);if(action==='remove'){if(!confirm('Remove '+person.name+' from this draft?'))return;state.content.people.splice(index,1);state.selectedPerson=state.content.people[Math.min(index,state.content.people.length-1)]?.id||null;}else if(action==='remove-photo'){person.photo='';person.photoAlt='';}else {const target=index+(action==='up'?-1:1);if(target<0||target>=state.content.people.length)return;[state.content.people[index],state.content.people[target]]=[state.content.people[target],state.content.people[index]];}markDirty();renderOverview();renderPeopleList();renderPersonEditor();});
$('#add-person').addEventListener('click',()=>{if(!state.content||state.content.people.length>=20)return;const id='person-'+(crypto.randomUUID?.()||Math.random().toString(36).slice(2)).slice(0,24);const person={id,name:'New team member',role:'Team member',bio:'A short introduction and background will go here.',photo:'',photoAlt:'',discord:'',email:'',visible:true,placeholder:false};state.content.people.push(person);state.selectedPerson=id;markDirty();renderOverview();renderPeopleList();renderPersonEditor();$('#person-name').focus();});
$('#save-draft').addEventListener('click',()=>saveDraft());$('#export-content').addEventListener('click',exportDraft);$('#settings-export').addEventListener('click',exportDraft);$('#publish-content').addEventListener('click',publish);
document.querySelectorAll('[data-preview]').forEach(link=>link.addEventListener('click',event=>{if(state.loading||state.photoBusy||!state.content||!saveDraft(false)){event.preventDefault();return;}status('Preview opened with your saved draft. Other visitors still see the published website.');}));
$('#import-content').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file||state.loading||state.photoBusy)return;
  try{
    if(file.size>2*1024*1024)throw new Error('Choose a draft smaller than 2 MB.');
    const text=await file.text();
    if(state.loading||state.photoBusy){status('The import was paused because another update started. Choose the file again after it finishes.',true);return;}
    const imported=restoreDraft(JSON.parse(text),state.serverRevision);
    if((state.dirty||state.hasDraft)&&!confirm('Replace your current draft with this imported file?'))return;
    state.content=imported.content;state.baseRevision=imported.baseRevision;state.ownerComplete=imported.ownerComplete;state.selectedPerson=state.content.people[0]?.id||null;
    markDirty();renderAll();
    if(saveDraft(false))status(!state.ownerComplete?INCOMPLETE_DRAFT_MESSAGE:state.baseRevision!==state.serverRevision?'This imported draft is based on an older published version. Export it, reload the latest owner content, and reapply your edits before publishing.':'Draft imported and saved on this device. Preview it before publishing.',!state.ownerComplete||state.baseRevision!==state.serverRevision);
  }catch(error){status(error.message||'This draft could not be imported.',true);}finally{event.target.value='';}
});
$('#reconnect-owner').addEventListener('click',async()=>{
  if (state.loading || state.photoBusy || state.reconnecting) return;
  if (state.dirty && !saveDraft(false)) return;
  state.reconnecting = true; state.loading = true; updateDraftState(); lockEditors(true);
  status('Checking the owner connection. Your draft is preserved.');
  try { await initialize(); }
  finally { state.reconnecting = false; state.loading = false; lockEditors(false); if (state.content) renderAll(); updateDraftState(); $('#reconnect-owner').focus({preventScroll:true}); }
});
for (const link of [$('#owner-signin'), $('#connection-signin')]) link.addEventListener('click',event=>{
  if (state.loading || state.photoBusy || state.reconnecting || (state.dirty && !saveDraft(false))) event.preventDefault();
});
$('#discard-draft').addEventListener('click',async()=>{if(!confirm('Discard the draft on this device and reload published content? Export first if you want to keep it.'))return;try{localStorage.removeItem(DRAFT_KEY);}catch{status('Could not remove the saved draft. Your browser may be blocking storage.',true);return;}state.dirty=false;state.hasDraft=false;state.savedAt=null;await initialize();status('Published content reloaded.');});
$('#refresh-stats').addEventListener('click',loadStats);$('#stats-days').addEventListener('change',loadStats);
window.addEventListener('beforeunload',event=>{if(state.dirty||state.loading||state.photoBusy){event.preventDefault();event.returnValue='';}});

async function initialize() {
  const [baseResult,publicResult,sessionResult] = await Promise.allSettled([request('assets/site-content.json'),request('api/content'),request('api/owner/session')]);
  let ownerContent = null, ownerContentError = null;
  const session = sessionResult.status === 'fulfilled' && sessionResult.value.owner === true ? sessionResult.value : null;
  const sessionError = sessionResult.status === 'rejected' ? sessionResult.reason : session ? null : connectionError('The owner service returned an unexpected response. Reconnect to try again.', 'invalid_session');
  if (session) {
    try {
      const candidate = await request('api/owner/content');
      if (!Number.isInteger(candidate.revision) || candidate.revision < 0 || (candidate.content === null && candidate.revision !== 0)) throw connectionError('The website content response could not be verified.', 'invalid_content_response');
      if (candidate.content !== null) validateSiteContent(candidate.content);
      ownerContent = candidate;
    } catch (error) { ownerContentError = error; }
  }
  applyConnection(session,ownerContent,sessionError,ownerContentError);
  try {
    const remote=ownerContent|| (publicResult.status==='fulfilled'?publicResult.value:null);const base=baseResult.status==='fulfilled'?baseResult.value:null;const published=validateSiteContent(remote?.content||base);state.published=clone(published);state.content=clone(published);state.serverRevision=Number.isInteger(remote?.revision)?remote.revision:0;state.baseRevision=state.serverRevision;state.ownerComplete=Boolean(session&&ownerContent)||state.serverRevision===0;state.savedAt=null;state.hasDraft=false;state.dirty=false;
    let draftIssue='';try{const raw=localStorage.getItem(DRAFT_KEY);if(raw){const saved=restoreDraft(JSON.parse(raw),state.serverRevision);state.content=saved.content;state.baseRevision=saved.baseRevision;state.ownerComplete=saved.ownerComplete;state.savedAt=saved.savedAt;state.hasDraft=true;if(!state.ownerComplete)draftIssue=INCOMPLETE_DRAFT_MESSAGE;else if(state.baseRevision!==state.serverRevision)draftIssue='The published site has changed since this draft was saved. Export your draft before reloading published content.';}}catch{draftIssue='Your saved draft could not be loaded. Published content is shown; the saved file has not been overwritten.';}
    state.selectedPerson=state.content.people[0]?.id||null;renderAll();['save-draft','export-content','settings-export','import-content','discard-draft'].forEach(id=>$('#'+id).disabled=false);$('#add-person').disabled=state.content.people.length>=20;
    if(draftIssue)status(draftIssue,true);else status('');if(state.authenticated)loadStats();
  } catch {status('The website content could not be loaded. Please reconnect to try again. Your saved draft has not been changed.',true);}
}
activatePanel(location.hash.slice(1).replace(/^panel-/,'')||'overview',false);
initialize();
