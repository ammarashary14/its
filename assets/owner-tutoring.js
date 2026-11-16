const tutoringRoot = document.querySelector('#owner-tutoring-workspace');
const websiteBase = new URL('../', import.meta.url);
const staticPreview = /(?:\.github\.io|\.chatgpt\.site)$/.test(location.hostname) || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const notificationLabels = {
  pending: 'Notification pending', sending: 'Notification sending', sent: 'Notification sent',
  failed: 'Notification failed', delivery_uncertain: 'Notification delivery uncertain'
};
function element(tag, className, text) {
  const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item;
}
function readable(value) { return typeof value === 'string' && value.trim() ? value : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join(', ') || 'Not provided' : 'Not provided'; }
function receivedDate(value) {
  if (typeof value !== 'string' || !value) return 'Date unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
}
function failure(message, code, status = 0) { const error = new Error(message); error.code = code; error.status = status; return error; }
async function fetchRequests() {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(new URL('api/owner/tutoring', websiteBase).href, {
      credentials: 'same-origin', cache: 'no-store', redirect: 'manual', headers: { Accept: 'application/json' }, signal: controller.signal
    });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) throw failure('Sign in through Cloudflare to view tutoring requests, then refresh this inbox.', 'sign_in_required', 401);
    let result; try { result = await response.json(); } catch { result = null; }
    if (response.ok && !result) throw failure('Sign in through Cloudflare to view tutoring requests, then refresh this inbox.', 'sign_in_required', 401);
    if (!response.ok) throw failure(result?.error || result?.reason || 'Tutoring requests could not be loaded right now.', result?.code || 'connection_unavailable', response.status);
    if (!Array.isArray(result?.requests) || result.requests.length > 100 || !result.requests.every(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.email === 'string' && typeof item.reference === 'string')) throw failure('The tutoring inbox returned an unexpected response. Refresh to try again.', 'invalid_response');
    return result.requests;
  } catch (error) {
    if (error.name === 'AbortError') throw failure('The tutoring inbox request timed out. Refresh to try again.', 'request_timeout');
    if (typeof error.code === 'string' && error.status !== undefined) throw error;
    throw failure('The website could not be reached. Refresh when your connection is available.', 'network_unavailable');
  } finally { clearTimeout(timeout); }
}

if (tutoringRoot) {
  const $ = selector => tutoringRoot.querySelector(selector);
  const state = { requests: [], selected: null, loading: false, connected: false };
  function status(message, error = false) {
    $('#tutoring-inbox-status').textContent = message; $('#tutoring-inbox-status').classList.toggle('is-error', error);
  }
  function renderDetail() {
    const target = $('#tutoring-request-detail'); target.replaceChildren();
    const request = state.requests.find(item => item.id === state.selected);
    if (!request) {
      target.append(element('h3', '', 'Request details'), element('p', 'owner-card-footnote', state.connected ? 'Submitted tutoring requests will appear here for you to review.' : 'Sign in to the connected owner dashboard to view private tutoring requests.'));
      return;
    }
    target.append(element('p', 'eyebrow', 'TUTORING REQUEST'), element('h3', '', request.name));
    const meta = element('div', 'owner-tutoring-meta'); meta.append(element('span', '', request.reference), element('span', 'owner-tutoring-badge', request.status === 'new' ? 'New request' : 'Request'));
    target.append(meta);
    const details = element('dl', 'owner-tutoring-fields');
    const fields = [
      ['Contact email', request.email], ['Submitted by', request.relationship], ['Grade level', request.grade], ['Subjects', request.subjects],
      ['Learning goals / help needed', request.needs], ['Preferred format', request.format], ['City / area', request.city], ['Availability', request.availability],
      ['Received', receivedDate(request.createdAt)]
    ];
    for (const [name, value] of fields) {
      const row = element('div'); row.append(element('dt', '', name), element('dd', '', readable(value))); details.append(row);
    }
    target.append(details);
    const notification = element('section', 'owner-tutoring-notification');
    const title = element('h4', '', notificationLabels[request.notificationStatus] || 'Notification status unavailable'); notification.append(title, element('p', '', 'Recipient: ammarashary@gmail.com'));
    const explanation = {
      pending: 'This request is saved. The email notification is waiting to be sent.',
      sending: 'This request is saved. The email notification is being sent.',
      sent: 'Gmail accepted the notification. Inbox delivery is not guaranteed.',
      failed: 'The request is saved here, but the email notification could not be sent.',
      delivery_uncertain: 'The request is saved here. Check the mailbox to see whether the notification arrived.'
    }[request.notificationStatus];
    if (explanation) notification.append(element('p', '', explanation));
    target.append(notification);
  }
  function renderRequests() {
    const holder = $('#tutoring-request-list'); holder.replaceChildren();
    $('#tutoring-request-count').textContent = state.connected ? state.requests.length === 100 ? 'Showing the 100 most recent requests' : `${state.requests.length} recent request${state.requests.length === 1 ? '' : 's'}` : 'Inbox unavailable';
    if (!state.requests.length) holder.append(element('p', 'owner-card-footnote', state.connected ? 'No tutoring requests yet.' : 'Tutoring requests will appear here after the owner connection is available.'));
    for (const request of state.requests) {
      const button = element('button', 'owner-tutoring-selector'); button.type = 'button'; button.dataset.tutoringRequestId = request.id; button.setAttribute('aria-pressed', String(request.id === state.selected));
      button.append(element('strong', '', request.name), element('span', '', readable(request.grade)), element('small', '', receivedDate(request.createdAt)));
      button.addEventListener('click', () => { state.selected = request.id; holder.querySelectorAll('[data-tutoring-request-id]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.tutoringRequestId === state.selected))); renderDetail(); }); holder.append(button);
    }
    renderDetail();
  }
  async function refresh() {
    if (state.loading) return;
    state.loading = true; $('#refresh-tutoring-requests').disabled = true; $('#refresh-tutoring-requests').textContent = 'Refreshing…'; tutoringRoot.setAttribute('aria-busy', 'true'); status('Loading tutoring requests…');
    try {
      state.requests = await fetchRequests(); state.connected = true;
      if (!state.requests.some(request => request.id === state.selected)) state.selected = state.requests[0]?.id || null;
      status(state.requests.length ? 'Tutoring requests are up to date.' : 'No tutoring requests have been submitted yet.');
    } catch (error) {
      // Remove previously displayed private records when a connection or sign-in check fails.
      state.requests = []; state.selected = null; state.connected = false;
      const signIn = error.status === 401 || error.status === 403 || error.code === 'sign_in_required';
      status(signIn ? 'Owner sign-in is required to view tutoring requests. Reconnect or sign in above, then refresh this inbox.' : staticPreview && error.status === 404 ? 'This preview has no tutoring inbox. Open the hosted owner dashboard to view requests.' : error.message, true);
    } finally {
      state.loading = false; $('#refresh-tutoring-requests').disabled = false; $('#refresh-tutoring-requests').textContent = 'Refresh requests ↻'; tutoringRoot.removeAttribute('aria-busy'); renderRequests();
    }
  }
  $('#refresh-tutoring-requests').addEventListener('click', refresh);
  renderRequests(); refresh();
}
