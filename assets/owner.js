import { validateSiteContent } from './content-schema.js?v=owner-8';

const DRAFT_KEY = 'bts-site-draft-v1';
const $ = selector => document.querySelector(selector);
const clone = value => JSON.parse(JSON.stringify(value));
const state = { content: null, published: null, baseRevision: 0, serverRevision: 0, savedAt: null, dirty: false, hasDraft: false, authenticated: false, canPublish: false, loading: false, selectedPerson: null, analyticsConfigured: false, photoBusy: false, ownerComplete: false };
const INCOMPLETE_DRAFT_MESSAGE = 'This draft may not include hidden profiles. Export it, reload the complete owner content in Settings, and reapply your edits before publishing.';
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
const sectionNames = { overview: 'Overview', content: 'Site content', people: 'Team profiles', applications: 'Applications', traffic: 'Traffic stats', settings: 'Settings' };
const contentGroups = [
  ['Homepage introduction', 'The first words visitors see.', [['home.headline','Headline',160],['home.headlineAccent','Second headline line',160],['home.description','Introduction',2000,true]]],
  ['Curriculum', 'Introduce math and science learning at each grade.', [['home.curriculumTitle','Heading',160],['home.curriculumAccent','Second heading line',160],['home.curriculumIntro','Curriculum description',2000,true]]],
  ['Our approach', 'Explain the purpose behind Breaking the Sky.', [['home.aboutTitle','Heading',160],['home.aboutAccent','Second heading line',160],['home.aboutText','About BTS',2000,true]]],
  ['1-on-1 tutoring', 'Help students understand the support available.', [['home.tutoringTitle','Heading',160],['home.tutoringAccent','Second heading line',160],['home.tutoringIntro','Tutoring introduction',2000,true]]],
  ['Contact', 'A clear invitation to get in touch.', [['home.contactIntro','Contact introduction',2000,true]]],
  ['Community', 'Add a Discord invitation and the public community email address.', [['community.name','Community name',100],['community.description','Community introduction',1000,true],['community.discordInvite','Discord server invite (optional)',200,false,true],['community.email','Public contact email',254]]],
  ['Team page', 'Set the scene before visitors meet your people.', [['team.title','Heading',160],['team.titleAccent','Second heading line (optional)',160,false,true],['team.intro','Team introduction',2000,true],['team.sectionIntro','Introduction above profiles',2000,true]]]
];

function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function status(message, error = false) { $('#owner-status').textContent = message; $('#owner-status').classList.toggle('is-error', error); }
function formatSaved(value) { try { return new Intl.DateTimeFormat(undefined, { month:'short',day:'numeric',hour:'numeric',minute:'2-digit' }).format(new Date(value)); } catch { return 'recently'; } }
function getPath(value, path) { const [group,key] = path.split('.'); return value[group]?.[key] || ''; }
function setPath(path, value) { const [group,key] = path.split('.'); state.content[group][key] = value; }
function markDirty() { state.dirty = true; updateDraftState(); }
function updateDraftState() {
  $('#draft-state').textContent = state.loading ? 'Publishing your changes…' : state.dirty ? 'Unsaved changes on this page' : state.hasDraft ? `Draft saved on this device${state.savedAt ? ' · '+formatSaved(state.savedAt) : ''}` : 'Viewing the published content';
  $('#publish-content').disabled = !state.canPublish || !state.ownerComplete || state.loading || state.photoBusy || !state.content;
  $('#publish-content').title = !state.canPublish ? 'Connect Cloudflare and verify owner access to publish' : !state.ownerComplete ? INCOMPLETE_DRAFT_MESSAGE : 'Publish these changes to the live website';
}
function activatePanel(name, focus = true) {
  if (!sectionNames[name]) name = 'overview';
  document.querySelectorAll('.owner-panel').forEach(el => { el.hidden = el.id !== 'panel-'+name; });
  document.querySelectorAll('[data-panel]').forEach(el => { if (el.dataset.panel === name) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
  $('#current-section').textContent = sectionNames[name];
  history.replaceState(null, '', '#panel-'+name);
  if (focus) $('#heading-'+name).focus({preventScroll:true});
}
async function request(path, options = {}) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options, signal:controller.signal });
    let data; try { data = await response.json(); } catch { data = null; }
    if (!response.ok || !data) { const error = new Error(data?.error || data?.reason || 'The connection is unavailable.'); error.status = response.status; error.code = data?.code; throw error; }
    return data;
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
      if(multiline)input.rows=4;else input.type=path==='community.email'?'email':path==='community.discordInvite'?'url':'text';field.htmlFor=input.id;field.append(input);grid.append(field);
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
  const photos=node('div','owner-photo-controls');photos.append(node('strong','','Profile photo'));const upload=node('input');upload.id='person-photo';upload.type='file';upload.accept='image/jpeg,image/png,image/webp';upload.setAttribute('aria-label','Upload a photo for '+person.name);photos.append(upload,node('p','','JPG, PNG, or WebP · Up to 10 MB. Photos are resized for the website.'));
  const removePhoto=node('button','owner-inline-button','Remove photo');removePhoto.type='button';removePhoto.dataset.personAction='remove-photo';removePhoto.disabled=!person.photo;photos.append(removePhoto);form.append(photos);container.append(form);renderPersonPreview();
}
function renderAll() { renderContentFields();renderOverview();renderPeopleList();renderPersonEditor();updateDraftState(); }
function saveDraft(showMessage = true) {
  try { const content=validateSiteContent(state.content);const savedAt=new Date().toISOString();localStorage.setItem(DRAFT_KEY,JSON.stringify(draftEnvelope(content,savedAt)));state.content=content;state.savedAt=savedAt;state.hasDraft=true;state.dirty=false;updateDraftState();if(showMessage)status(state.ownerComplete?'Draft saved on this device. Visitors still see the published website.':INCOMPLETE_DRAFT_MESSAGE,!state.ownerComplete);return true; }
  catch(error){status(error.name==='QuotaExceededError'?'This device doesn’t have enough space to save the draft. Remove a large photo or export a copy to keep your work.':error.message||'Could not save this draft. Export a copy to keep your work.',true);return false;}
}
function exportDraft() {
  if(state.loading||state.photoBusy)return;
  try {const content=validateSiteContent(state.content);const blob=new Blob([JSON.stringify(draftEnvelope(content,new Date().toISOString()),null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const link=node('a');link.href=url;link.download='bts-site-content.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Draft exported. Share the file in our chat to publish before Cloudflare is connected.');}catch(error){status(error.message,true);}
}
async function uploadPhoto(file, personId) {
  if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){status('Choose a JPG, PNG, or WebP photo. SVG files are not supported.',true);return;}if(file.size>10*1024*1024){status('Please choose a photo smaller than 10 MB.',true);return;}
  if(state.loading||state.photoBusy)return;state.photoBusy=true;updateDraftState();lockEditors(true);status('Preparing your photo…');
  try {
    const source=URL.createObjectURL(file);let img;
    try {img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('That photo could not be opened. Try another image.'));image.src=source;});}
    finally {URL.revokeObjectURL(source);}
    if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>50000000)throw new Error('Please choose a smaller photo.');
    const scale=Math.min(1,640/img.naturalWidth,800/img.naturalHeight);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Photo processing is unavailable in this browser.');ctx.fillStyle='#e9dfce';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    let photo='';for(const quality of [.86,.74,.62,.5]){photo=canvas.toDataURL('image/jpeg',quality);if(photo.length<=340000)break;}if(photo.length>340000)throw new Error('This photo is still too large. Try a smaller image.');
    const person=state.content.people.find(p=>p.id===personId);if(!person)return;const next=clone(state.content);next.people.find(p=>p.id===personId).photo=photo;validateSiteContent(next);person.photo=photo;if(!person.photoAlt)person.photoAlt='Portrait of '+person.name;markDirty();renderPeopleList();renderPersonEditor();renderOverview();status('Photo added to your draft. Save when you’re ready.');
  }catch(error){status(error.message||'The photo could not be added.',true);}
  finally{state.photoBusy=false;lockEditors(false);updateDraftState();}
}
function applyConnection(session, ownerContent, sessionError) {
  state.authenticated=Boolean(session?.owner);state.canPublish=Boolean(session?.owner&&ownerContent);state.analyticsConfigured=Boolean(session?.analyticsConfigured);
  if(state.canPublish){$('#connection-heading').textContent='Owner connected';$('#connection-description').textContent='Save a draft, preview your changes, then publish them to the website. Only the approved owner can publish.';$('#sidebar-mode').textContent='Owner connected';$('#sidebar-mode-help').textContent=session.email;$('#settings-mode').textContent='Owner publishing';$('#settings-auth').textContent=session.email;$('#settings-publishing').textContent='Connected';$('#settings-explanation').textContent='Owner access is verified by Cloudflare. Publish changes makes this draft visible on the website.';}
  else if(state.authenticated){$('#connection-heading').textContent='Content storage not connected';$('#connection-description').textContent='Owner access is verified. You can save local drafts while Cloudflare content storage is being connected.';$('#settings-auth').textContent=session.email;$('#settings-publishing').textContent='Storage setup needed';$('#settings-explanation').textContent='Owner access is working, but content storage is not ready. Your edits remain local drafts.';}
  else if(sessionError?.status===401||sessionError?.status===403){$('#connection-heading').textContent='Owner sign-in required';$('#connection-description').textContent='You can work on a local draft. Sign in as the approved owner to publish changes.';$('#settings-auth').textContent='Sign-in required';$('#owner-signin').hidden=false;}
  $('#settings-analytics').textContent=state.analyticsConfigured?'Configured':'Not connected';$('#refresh-stats').disabled=!state.authenticated;updateDraftState();
}
function numeric(value) { return Number.isFinite(value)&&value>=0?value:null; }
function numberText(value) { return numeric(value)===null?'—':new Intl.NumberFormat().format(value); }
function byteText(value) {if(numeric(value)===null)return'—';if(value<1024)return value+' B';const units=['KB','MB','GB','TB'];let n=value/1024,index=0;while(n>=1024&&index<units.length-1){n/=1024;index++;}return new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n)+' '+units[index];}
let statsRequestId = 0;
async function loadStats() {
  if(!state.authenticated)return;const requestId=++statsRequestId;$('#refresh-stats').disabled=true;$('#refresh-stats').textContent='Refreshing…';
  try {
    const days=Number($('#stats-days').value);const result=await request('api/owner/stats?days='+days);if(requestId!==statsRequestId)return;
    if(result.connected!==true){$('#stats-connected').hidden=true;$('#stats-unconnected').hidden=false;$('#stats-empty-description').textContent='Cloudflare analytics is not connected yet. Once it is configured, real traffic will appear here.';$('#overview-pageviews').textContent='—';$('#overview-traffic-note').textContent='Analytics not connected';return;}
    if(!result.totals||!Array.isArray(result.daily))throw new Error('Traffic data is unavailable.');
    $('#stats-connected').hidden=false;$('#stats-unconnected').hidden=true;$('#stats-pageviews').textContent=numberText(result.totals.pageViews);$('#stats-requests').textContent=numberText(result.totals.requests);$('#stats-bytes').textContent=byteText(result.totals.bytes);$('#overview-pageviews').textContent=numberText(result.totals.pageViews);$('#overview-traffic-note').textContent='Last '+days+' complete days · Cloudflare';
    $('#stats-updated').textContent=result.updatedAt?'Updated '+formatSaved(result.updatedAt):'';$('#stats-period').textContent='Cloudflare zone traffic · Complete UTC days. Unique IPs indicate approximate reach, not confirmed individual visitors.';
    const rows=$('#stats-rows');rows.replaceChildren();result.daily.forEach(day=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date))return;const tr=node('tr');const date=new Date(day.date+'T12:00:00Z');tr.append(node('td','',new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',timeZone:'UTC'}).format(date)),node('td','',numberText(day.pageViews)),node('td','',numberText(day.requests)),node('td','',numberText(day.uniqueIPs)));rows.append(tr);});if(!rows.children.length){const tr=node('tr');const td=node('td','','No daily records for this period.');td.colSpan=4;tr.append(td);rows.append(tr);}
  } catch {if(requestId!==statsRequestId)return;$('#stats-connected').hidden=true;$('#stats-unconnected').hidden=false;$('#stats-empty-description').textContent='Traffic data could not be loaded. Please try refreshing again. No estimated numbers are shown.';$('#overview-pageviews').textContent='—';$('#overview-traffic-note').textContent='Traffic temporarily unavailable';}
  finally {if(requestId===statsRequestId){$('#refresh-stats').disabled=false;$('#refresh-stats').textContent='Refresh stats ↻';}}
}
const disabledDuringPublish = new Map();
function lockEditors(locked) {
  if (locked) document.querySelectorAll('#owner-main input, #owner-main textarea, #owner-main select, #owner-main button').forEach(control=>{disabledDuringPublish.set(control,control.disabled);control.disabled=true;});
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
$('#people-list').addEventListener('click',event=>{const button=event.target.closest('[data-person-id]');if(!button)return;state.selectedPerson=button.dataset.personId;renderPeopleList();renderPersonEditor();});
$('#person-editor').addEventListener('input',event=>{const key=event.target.dataset.personField;const person=currentPerson();if(!key||!person)return;person[key]=event.target.type==='checkbox'?event.target.checked:event.target.value;markDirty();renderPeopleList();renderPersonPreview();renderOverview();});
$('#person-editor').addEventListener('change',event=>{if(event.target.id==='person-photo')uploadPhoto(event.target.files[0],state.selectedPerson);});
$('#person-editor').addEventListener('click',event=>{const button=event.target.closest('[data-person-action]');const person=currentPerson();if(!button||!person)return;const action=button.dataset.personAction;const index=state.content.people.indexOf(person);if(action==='remove'){if(!confirm('Remove '+person.name+' from this draft?'))return;state.content.people.splice(index,1);state.selectedPerson=state.content.people[Math.min(index,state.content.people.length-1)]?.id||null;}else if(action==='remove-photo'){person.photo='';person.photoAlt='';}else {const target=index+(action==='up'?-1:1);if(target<0||target>=state.content.people.length)return;[state.content.people[index],state.content.people[target]]=[state.content.people[target],state.content.people[index]];}markDirty();renderOverview();renderPeopleList();renderPersonEditor();});
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
$('#discard-draft').addEventListener('click',async()=>{if(!confirm('Discard the draft on this device and reload published content? Export first if you want to keep it.'))return;try{localStorage.removeItem(DRAFT_KEY);}catch{status('Could not remove the saved draft. Your browser may be blocking storage.',true);return;}state.dirty=false;state.hasDraft=false;state.savedAt=null;await initialize();status('Published content reloaded.');});
$('#refresh-stats').addEventListener('click',loadStats);$('#stats-days').addEventListener('change',loadStats);
window.addEventListener('beforeunload',event=>{if(state.dirty||state.loading||state.photoBusy){event.preventDefault();event.returnValue='';}});

async function initialize() {
  const [baseResult,publicResult,sessionResult]=await Promise.allSettled([request('assets/site-content.json'),request('api/content'),request('api/owner/session')]);
  let ownerContent=null;const session=sessionResult.status==='fulfilled'&&sessionResult.value.owner===true?sessionResult.value:null;
  if(session){try{ownerContent=await request('api/owner/content');}catch{ownerContent=null;}}
  try {
    const remote=ownerContent|| (publicResult.status==='fulfilled'?publicResult.value:null);const base=baseResult.status==='fulfilled'?baseResult.value:null;const published=validateSiteContent(remote?.content||base);state.published=clone(published);state.content=clone(published);state.serverRevision=Number.isInteger(remote?.revision)?remote.revision:0;state.baseRevision=state.serverRevision;state.ownerComplete=Boolean(session&&ownerContent)||state.serverRevision===0;state.savedAt=null;state.hasDraft=false;state.dirty=false;
    let draftIssue='';try{const raw=localStorage.getItem(DRAFT_KEY);if(raw){const saved=restoreDraft(JSON.parse(raw),state.serverRevision);state.content=saved.content;state.baseRevision=saved.baseRevision;state.ownerComplete=saved.ownerComplete;state.savedAt=saved.savedAt;state.hasDraft=true;if(!state.ownerComplete)draftIssue=INCOMPLETE_DRAFT_MESSAGE;else if(state.baseRevision!==state.serverRevision)draftIssue='The published site has changed since this draft was saved. Export your draft before reloading published content.';}}catch{draftIssue='Your saved draft could not be loaded. Published content is shown; the saved file has not been overwritten.';}
    state.selectedPerson=state.content.people[0]?.id||null;applyConnection(session,ownerContent,sessionResult.status==='rejected'?sessionResult.reason:null);renderAll();['save-draft','export-content','settings-export','import-content','discard-draft'].forEach(id=>$('#'+id).disabled=false);$('#add-person').disabled=state.content.people.length>=20;
    if(draftIssue)status(draftIssue,true);else status('');if(state.authenticated)loadStats();
  } catch {status('The website content could not be loaded. Please refresh to try again. Your saved draft has not been changed.',true);}
}
activatePanel(location.hash.slice(1).replace(/^panel-/,'')||'overview',false);
initialize();
