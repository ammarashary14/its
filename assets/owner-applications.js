const root = document.querySelector('#owner-applications-workspace');
const TEMPLATE_KEY = 'bts-decision-templates-v1';
const DECISIONS = ['accepted', 'rejected'];
const defaults = () => ({ accepted: { subject: 'Your BTS volunteer application', body: '' }, rejected: { subject: 'Your BTS volunteer application', body: '' } });
const sample = { name: 'Sample applicant', email: 'sample@example.com', reference: 'BTS-SAMPLE' };
const clone = value => JSON.parse(JSON.stringify(value));
const label = value => ({ pending: 'Awaiting review', sending: 'Sending email', accepted: 'Accepted', rejected: 'Rejected', delivery_uncertain: 'Check email delivery' }[value] || value);

function validateTemplates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a valid email template file.');
  const result = {};
  for (const decision of DECISIONS) {
    const entry = value[decision];
    if (!entry || typeof entry.subject !== 'string' || typeof entry.body !== 'string') throw new Error('Both decisions need a subject and message.');
    const subject = entry.subject.trim(); const body = entry.body.trim();
    if (subject.length > 200 || /[\r\n\x00-\x1f\x7f]/.test(subject)) throw new Error('Keep each subject on one line, no longer than 200 characters.');
    if (body.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)) throw new Error('Keep each message under 10,000 characters.');
    if (/{{|}}/.test((subject + '\n' + body).replace(/{{(?:name|email|reference)}}/g, ''))) throw new Error('Use only {{name}}, {{email}}, and {{reference}} as placeholders, without spaces inside the braces.');
    result[decision] = { subject, body };
  }
  return result;
}
function expand(template, applicant) {
  return template.replace(/\{\{(name|email|reference)\}\}/g, (_, key) => applicant[key] || '');
}
function element(tag, className, text) {
  const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el;
}
async function request(path, options = {}, wait = 12000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), wait);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
    let data; try { data = await response.json(); } catch { data = null; }
    if (!response.ok || !data) {
      const error = new Error(data?.error || 'The application service is not connected yet.');
      error.status = response.status; error.code = data?.code; throw error;
    }
    return data;
  } finally { clearTimeout(timer); }
}

if (root) {
  const $ = selector => root.querySelector(selector);
  const state = { templates: defaults(), revision: 0, server: null, applications: [], canSend: false, connected: false, settingsConnected: false, dirty: false, localDraft: false, busy: false, sending: false, selected: null };
  let dialog = null;
  function status(text, error = false) { $('#applications-status').textContent = text; $('#applications-status').classList.toggle('is-error', error); }
  function readInputs() {
    const templates = {};
    for (const key of DECISIONS) templates[key] = { subject: $(`#template-${key}-subject`).value, body: $(`#template-${key}-body`).value };
    return validateTemplates(templates);
  }
  function renderTemplatePreview() {
    for (const decision of DECISIONS) {
      $(`#template-${decision}-preview-subject`).textContent = expand($(`#template-${decision}-subject`).value, sample);
      $(`#template-${decision}-preview-body`).textContent = expand($(`#template-${decision}-body`).value, sample) || 'Write your message to see the preview here.';
    }
  }
  function fillInputs() {
    for (const decision of DECISIONS) {
      $(`#template-${decision}-subject`).value = state.templates[decision].subject;
      $(`#template-${decision}-body`).value = state.templates[decision].body;
    }
    renderTemplatePreview(); updateControls();
  }
  function updateControls() {
    $('#save-email-templates').disabled = !state.settingsConnected || state.busy || state.sending;
    $('#refresh-applications').disabled = state.busy || state.sending;
    $('#load-server-templates').disabled = !state.server || state.busy || state.sending;
    $('#save-template-draft').disabled = state.busy || state.sending;
    $('#export-email-templates').disabled = state.busy || state.sending;
    $('#import-email-templates').disabled = state.busy || state.sending;
    root.querySelectorAll('[data-template-input]').forEach(input => { input.disabled = state.busy || state.sending; });
    $('#template-draft-state').textContent = state.dirty ? 'Unsaved message edits' : state.localDraft ? 'Message draft saved on this device' : state.settingsConnected ? 'Showing saved server messages' : 'Write your messages here; save a draft until email is connected.';
    $('#application-connection').textContent = !state.connected ? 'Connect Cloudflare to review new applications here. Earlier applications remain in the mailbox that originally received them.' : state.canSend ? 'Applications are connected and Gmail sending is configured.' : 'Applications are connected. Connect breakingtheskyadmissions@gmail.com to enable decision emails.';
  }
  function saveLocal() {
    const templates = readInputs();
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify({ version: 1, templates, baseRevision: state.revision, savedAt: new Date().toISOString() }));
    state.templates = templates; state.dirty = false; state.localDraft = true; updateControls();
  }
  function selectedApplication() { return state.applications.find(item => item.id === state.selected); }
  function renderDetail() {
    const holder = $('#application-detail'); holder.replaceChildren();
    const application = selectedApplication();
    if (!application) { holder.append(element('p', 'owner-card-footnote', state.applications.length ? 'Choose an application to read the answers and review a decision.' : 'Applications submitted after the Cloudflare connection will appear here.')); return; }
    holder.append(element('p', 'eyebrow', 'APPLICATION DETAILS'), element('h3', '', application.name));
    const meta = element('div', 'applicant-meta');
    const email = element('a', '', application.email); email.href = `mailto:${encodeURIComponent(application.email)}`;
    meta.append(email, element('span', '', application.reference), element('span', 'application-badge', label(application.status))); holder.append(meta);
    const notifications = {pending:'Admissions email queued; Gmail may still need connecting.',sending:'Sending the admissions notification.',sent:'Admissions notification sent to breakingtheskyadmissions@gmail.com.',failed:'Admissions notification was not sent. Check Gmail settings; the application is saved.',delivery_uncertain:'Check Gmail before retrying the admissions notification.'};
    if (notifications[application.notificationStatus]) holder.append(element('p', 'owner-card-footnote', notifications[application.notificationStatus]));
    const answers = element('pre', 'applicant-answers', application.message); answers.tabIndex = 0; holder.append(answers);
    const actions = element('div', 'application-decision-actions');
    for (const decision of DECISIONS) {
      const button = element('button', decision === 'accepted' ? 'owner-primary' : 'owner-secondary', decision === 'accepted' ? 'Accept…' : 'Reject…'); button.type = 'button'; button.dataset.decision = decision;
      button.disabled = !state.canSend || state.busy || state.sending || application.status !== 'pending';
      button.addEventListener('click', () => openDecision(application.id, decision)); actions.append(button);
    }
    holder.append(actions);
    if (application.status === 'delivery_uncertain' || application.status === 'sending') holder.append(element('p', 'owner-card-footnote', 'Email delivery needs checking before another decision can be sent. Refresh the inbox and check your email provider.'));
    else if (['accepted', 'rejected'].includes(application.status)) holder.append(element('p', 'owner-card-footnote', 'The email provider accepted this decision message. Inbox delivery is not guaranteed.'));
    else holder.append(element('p', 'owner-card-footnote', state.canSend ? 'You’ll review the exact recipient and message before sending.' : 'Connect the email service before accepting or rejecting applications.'));
  }
  function renderApplications() {
    const holder = $('#application-inbox'); holder.replaceChildren();
    $('#application-inbox-count').textContent = state.connected ? `${state.applications.length} recent application${state.applications.length === 1 ? '' : 's'}` : 'Not connected';
    if (!state.applications.length) holder.append(element('p', 'owner-card-footnote', state.connected ? 'No applications have been submitted here yet.' : 'Your application inbox will appear here after setup.'));
    for (const item of state.applications) {
      const button = element('button', 'application-inbox-item'); button.type = 'button'; button.dataset.applicationId = item.id; button.setAttribute('aria-pressed', String(state.selected === item.id));
      button.append(element('strong', '', item.name), element('span', '', item.email), element('small', 'application-badge', label(item.status)));
      button.disabled = state.sending; button.addEventListener('click', () => { if (state.sending) return; state.selected = item.id; renderApplications(); }); holder.append(button);
    }
    renderDetail(); updateControls();
  }
  async function refresh() {
    if (state.busy || state.sending) return;
    state.busy = true; updateControls();
    const [inbox, settings] = await Promise.allSettled([request('api/owner/applications'), request('api/owner/application-settings')]);
    if (inbox.status === 'fulfilled' && Array.isArray(inbox.value.applications)) {
      state.applications = inbox.value.applications.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.email === 'string' && typeof item.message === 'string'); state.connected = true; state.canSend = inbox.value.canSend === true;
      if (!state.applications.some(item => item.id === state.selected)) state.selected = state.applications[0]?.id || null;
    } else { state.connected = false; state.canSend = false; state.applications = []; state.selected = null; }
    state.settingsConnected = false;
    if (settings.status === 'fulfilled') {
      try {
        const templates = validateTemplates(settings.value.templates); const revision = settings.value.revision;
        if (!Number.isInteger(revision) || revision < 0) throw new Error('Invalid revision');
        state.server = { templates, revision }; state.settingsConnected = true;
        if (!state.dirty && !state.localDraft) { state.templates = clone(templates); state.revision = revision; fillInputs(); }
      } catch { state.server = null; }
    } else state.server = null;
    state.busy = false; renderApplications();
    if (state.settingsConnected && state.localDraft && state.revision !== state.server.revision) status('Your message draft is based on an older server version. Export it before choosing “Load saved messages” and reapplying your changes.', true);
  }
  function closeDialog() {
    if (!dialog || state.sending) return;
    const previous = dialog._previous; dialog.close?.(); dialog.remove(); dialog = null; previous?.focus?.();
  }
  function openDecision(id, decision) {
    if (state.busy || state.sending || !state.connected || !state.canSend || dialog) return;
    const application = state.applications.find(item => item.id === id);
    if (!application || application.status !== 'pending') return;
    let template; try { template = readInputs()[decision]; if (!template.body) throw new Error(`Write your ${decision === 'accepted' ? 'acceptance' : 'rejection'} message in Email messages first.`); } catch (error) { status(error.message, true); return; }
    const subject = expand(template.subject, application); const body = expand(template.body, application);
    if (!subject.trim() || subject.length > 200 || /[\r\n\x00-\x1f\x7f]/.test(subject) || !body.trim() || body.length > 12000 || /{{|}}/.test(subject + body)) { status('The personalized message needs a subject of 1–200 characters and a body of 1–12,000 characters, with all placeholders replaced. Shorten or correct the template before sending.', true); return; }
    dialog = element('dialog', 'application-decision-dialog'); dialog.setAttribute('aria-labelledby', 'decision-dialog-title'); dialog._previous = document.activeElement;
    dialog.append(element('p', 'eyebrow', 'REVIEW BEFORE SENDING'));
    const title = element('h2', '', decision === 'accepted' ? 'Accept this application?' : 'Reject this application?'); title.id = 'decision-dialog-title'; dialog.append(title);
    dialog.append(element('p', 'decision-recipient', 'From: breakingtheskyadmissions@gmail.com'), element('p', 'decision-recipient', `To: ${application.email}`), element('p', 'decision-subject', `Subject: ${subject}`), element('pre', 'decision-body', body));
    dialog.append(element('p', 'owner-card-footnote', 'This sends one email to the address on the application and records your decision.'));
    const message = element('p', 'decision-status'); message.setAttribute('role', 'status'); dialog.append(message);
    const actions = element('div', 'application-decision-actions'); const cancel = element('button', 'owner-secondary', 'Back'); cancel.type = 'button'; cancel.addEventListener('click', closeDialog);
    const send = element('button', 'owner-primary', decision === 'accepted' ? 'Accept and send email' : 'Reject and send email'); send.type = 'button'; actions.append(cancel, send); dialog.append(actions);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    document.body.append(dialog);
    if (typeof dialog.showModal !== 'function') { dialog.remove(); dialog = null; status('Use a current browser to review and send decision emails.', true); return; }
    dialog.showModal(); cancel.focus();
    send.addEventListener('click', async () => {
      if (state.sending || !dialog) return;
      state.sending = true; send.disabled = true; cancel.disabled = true; updateControls(); message.textContent = 'Sending your decision…';
      try {
        const result = await request('api/owner/applications/decision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision, subject, body }) }, 30000);
        if (result.success !== true || result.emailAccepted !== true || !result.application) throw new Error('Email receipt could not be confirmed.');
        const index = state.applications.findIndex(item => item.id === id); if (index >= 0) state.applications[index] = result.application;
        status(`${decision === 'accepted' ? 'Acceptance' : 'Rejection'} email accepted by the email provider for ${application.email}.`);
        state.sending = false; closeDialog(); renderApplications();
      } catch (error) {
        const uncertain = !error.status || error.code === 'delivery_uncertain';
        if (uncertain) application.status = 'delivery_uncertain';
        else if (error.status === 409) application.status = 'sending';
        message.textContent = uncertain ? 'We couldn’t confirm delivery. Check the email provider before trying again; sending is paused for this application.' : error.message;
        status(message.textContent, true); state.sending = false; cancel.disabled = false;
        send.disabled = uncertain || error.status === 409 || error.status === 401 || error.status === 403 || error.status === 503;
        renderApplications();
      }
    });
  }
  for (const input of root.querySelectorAll('[data-template-input]')) input.addEventListener('input', () => { state.dirty = true; renderTemplatePreview(); updateControls(); });
  $('#save-template-draft').addEventListener('click', () => { try { saveLocal(); status('Email message draft saved on this device. No email was sent.'); } catch (error) { status(error.message || 'Your browser could not save this draft. Export a copy instead.', true); } });
  $('#save-email-templates').addEventListener('click', async () => {
    if (!state.settingsConnected || state.busy || state.sending) return;
    let templates; try { templates = readInputs(); } catch (error) { status(error.message, true); return; }
    state.busy = true; updateControls();
    try {
      const result = await request('api/owner/application-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templates, expectedRevision: state.revision }) });
      state.templates = validateTemplates(result.templates); state.revision = result.revision; state.server = { templates: clone(state.templates), revision: state.revision }; state.dirty = false; state.localDraft = false;
      try { localStorage.removeItem(TEMPLATE_KEY); } catch { /* Saved server messages remain valid. */ }
      fillInputs(); status('Email messages saved. No email was sent.');
    } catch (error) { status(error.status === 409 ? 'The saved messages changed elsewhere. Export your edits, load the saved messages, and reapply your changes.' : error.message, true); }
    finally { state.busy = false; updateControls(); }
  });
  $('#load-server-templates').addEventListener('click', () => {
    if (!state.server || state.busy || state.sending) return;
    if ((state.dirty || state.localDraft) && !confirm('Replace these message edits with the saved server messages? Export first to keep a copy.')) return;
    state.templates = clone(state.server.templates); state.revision = state.server.revision; state.dirty = false; state.localDraft = false;
    try { localStorage.removeItem(TEMPLATE_KEY); } catch {}
    fillInputs(); status('Saved server messages loaded.');
  });
  $('#export-email-templates').addEventListener('click', () => {
    if (state.busy || state.sending) return;
    try {
      const templates = readInputs(); const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, templates, baseRevision: state.revision }, null, 2) + '\n'], { type: 'application/json' }));
      const link = element('a'); link.href = url; link.download = 'bts-decision-messages.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('Email message draft exported. Applicant records are not included.');
    } catch (error) { status(error.message, true); }
  });
  $('#import-email-templates').addEventListener('click', () => $('#email-template-file').click());
  $('#email-template-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file || state.busy || state.sending) return;
    try {
      if (file.size > 50000) throw new Error('Choose a template file smaller than 50 KB.');
      const incoming = JSON.parse(await file.text()); if (state.busy || state.sending) throw new Error('Another action started. Choose the file again when it finishes.');
      const templates = validateTemplates(incoming.templates);
      if (incoming.version !== 1 || !Number.isInteger(incoming.baseRevision) || incoming.baseRevision < 0) throw new Error('Choose an exported BTS decision message file.');
      if ((state.dirty || state.localDraft) && !confirm('Replace these message edits with the imported templates?')) return;
      state.templates = templates; state.revision = incoming.baseRevision; state.dirty = true; fillInputs(); status('Email messages imported. Save a draft or save them to the connected server.');
    } catch (error) { status(error.message, true); } finally { event.target.value = ''; }
  });
  $('#refresh-applications').addEventListener('click', refresh);
  window.addEventListener('beforeunload', event => { if (state.dirty || state.sending || state.busy) { event.preventDefault(); event.returnValue = ''; } });
  try {
    const saved = localStorage.getItem(TEMPLATE_KEY);
    if (saved) {
      if (saved.length > 50000) throw new Error('Saved messages are too large.');
      const draft = JSON.parse(saved); state.templates = validateTemplates(draft.templates);
      if (draft.version !== 1 || !Number.isInteger(draft.baseRevision) || draft.baseRevision < 0) throw new Error('The saved message draft is not valid.');
      state.revision = draft.baseRevision; state.localDraft = true;
    }
  } catch { state.templates = defaults(); status('The saved email message draft could not be opened. It has not been overwritten.', true); }
  fillInputs(); renderApplications(); refresh();
}
