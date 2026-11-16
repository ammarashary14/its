(() => {
  'use strict';
  const form = document.querySelector('[data-tutoring-form]');
  if (!form) return;
  const script = new URL(document.currentScript?.src || 'assets/tutoring.js', document.baseURI);
  const candidate = new URL('../api/tutoring', script);
  const endpoint = candidate.origin === location.origin ? candidate : new URL('api/tutoring', location.href);
  const review = document.querySelector('#tutoring-review');
  const summary = review.querySelector('.review-summary');
  const sendButton = document.querySelector('#send-tutoring');
  const editButton = document.querySelector('#edit-tutoring');
  const errorBox = document.querySelector('#tutoring-submission-error');
  const formError = document.querySelector('#tutoring-form-error');
  const status = document.querySelector('#tutoring-submission-status');
  const connection = document.querySelector('#tutoring-connection-status');
  const success = document.querySelector('#tutoring-success');
  const fieldNames = ['name', 'email', 'relationship', 'grade', 'subjects', 'needs', 'format', 'city', 'availability'];
  const definiteRejections = new Set(['invalid_tutoring', 'invalid_json', 'json_required', 'body_too_large', 'origin_rejected', 'method_not_allowed', 'tutoring_not_configured']);
  let reference = '', reviewPayload = null, attemptedPayload = null;
  let sending = false, submitted = false, uncertain = false, conflict = false;
  let available = null, discovery = null;

  function uuid() {
    const random = window.crypto;
    if (typeof random?.randomUUID === 'function') return random.randomUUID().toUpperCase();
    if (typeof random?.getRandomValues !== 'function') throw new Error('Secure submission is unavailable in this browser. Open this page in a current browser to continue.');
    const bytes = random.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function controls() {
    sendButton.disabled = sending || submitted || conflict;
    editButton.disabled = sending || submitted || uncertain || conflict;
    sendButton.textContent = sending ? 'Submitting…' : submitted ? 'Request submitted' : attemptedPayload ? 'Retry submission' : 'Submit tutoring request';
    if (sending) review.setAttribute('aria-busy', 'true'); else review.removeAttribute('aria-busy');
  }
  function showError(message) {
    errorBox.textContent = message; errorBox.hidden = false; status.textContent = ''; errorBox.focus();
  }
  function checkAvailability() {
    if (discovery) return discovery;
    discovery = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
        const data = response.ok ? await response.json() : null;
        available = data?.enabled === true;
      } catch { available = false; }
      finally { clearTimeout(timer); }
      connection.textContent = available
        ? 'Submit your request here after reviewing your details.'
        : 'Submission is temporarily unavailable. You can prepare your request and retry from the review screen.';
      return available;
    })().finally(() => { discovery = null; });
    return discovery;
  }
  function capture() {
    const payload = {};
    for (const name of fieldNames) {
      const field = form.elements.namedItem(name);
      field.value = field.value.trim();
      field.setCustomValidity(field.required && !field.value ? 'Please enter a value, not just spaces.' :
        field.maxLength > 0 && field.value.length > field.maxLength ? `Keep this answer within ${field.maxLength} characters.` : '');
      payload[name] = field.value;
    }
    if (!form.reportValidity()) return null;
    if (!form.elements.namedItem('consent').checked) return null;
    if (form.elements.namedItem('honey').value) throw new Error('This request could not be submitted. Contact BTS if you need help.');
    if (!reference) reference = 'BTS-TUTOR-' + uuid();
    return { reference, ...payload, consent: true, honey: '' };
  }
  form.querySelectorAll('input, select, textarea').forEach(field => {
    const clear = () => { field.setCustomValidity(''); formError.hidden = true; };
    field.addEventListener('input', clear); field.addEventListener('change', clear);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (sending || submitted || uncertain || conflict) return;
    try {
      const payload = capture(); if (!payload) return;
      reviewPayload = payload;
      const lines = ['1-on-1 tutoring request — Breaking the Sky', `Request reference: ${reference}`];
      for (const name of fieldNames) lines.push(`${form.elements.namedItem(name).dataset.label}: ${payload[name] || 'Not provided'}`);
      lines.push('Permission to contact: I agree that BTS may contact me about this tutoring request.');
      summary.textContent = lines.join('\n\n');
      errorBox.hidden = true; status.textContent = ''; form.hidden = true; review.hidden = false;
      controls(); document.querySelector('#tutoring-review-title').focus();
      review.scrollIntoView?.({ behavior: 'auto', block: 'start' });
    } catch (error) { formError.textContent = error.message; formError.hidden = false; formError.focus(); }
  });
  editButton.addEventListener('click', () => {
    if (sending || submitted || uncertain || conflict) return;
    review.hidden = true; form.hidden = false; errorBox.hidden = true;
    form.querySelector('input:not([name="honey"])').focus();
  });
  sendButton.addEventListener('click', async () => {
    if (sending || submitted || conflict || review.hidden || !reviewPayload) return;
    sending = true; errorBox.hidden = true; controls(); status.textContent = 'Submitting your request. Please keep this page open.';
    let timer;
    try {
      // After any attempted POST, only this same backend and exact snapshot can
      // confirm receipt. Capability checks never redirect or change providers.
      if (!attemptedPayload && available !== true && !await checkAvailability()) {
        showError('Submission is temporarily unavailable. Your answers are still here. Try submitting again shortly, or contact BTS for help.');
        return;
      }
      const payload = attemptedPayload || { ...reviewPayload };
      attemptedPayload = payload;
      const controller = new AbortController(); timer = setTimeout(() => controller.abort(), 25000);
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload)
      });
      let data; try { data = await response.json(); } catch { data = null; }
      if (response.ok && data?.success === true && data.reference === payload.reference) {
        submitted = true;
        form.reset(); form.replaceChildren(); summary.textContent = ''; reviewPayload = null; attemptedPayload = null;
        review.hidden = true; success.hidden = false; status.textContent = '';
        document.querySelector('#tutoring-submission-reference').textContent = reference;
        document.querySelector('#tutoring-success-title').focus(); success.scrollIntoView?.({ behavior: 'auto', block: 'start' });
        return;
      }
      if (response.status === 409 && data?.code === 'tutoring_reference_conflict') {
        conflict = true;
        showError(`Reference ${reference} is already attached to different details. Contact BTS with this reference before submitting again. Your answers are still shown here.`);
        return;
      }
      if (!response.ok && definiteRejections.has(data?.code) && !uncertain) {
        attemptedPayload = null;
        if (data.code === 'tutoring_not_configured') available = false;
        showError(data.code === 'invalid_tutoring'
          ? 'Your request was not accepted. Edit your details to check the required answers and try again.'
          : 'Your request was not accepted. Your answers are still here. Try again shortly or contact BTS for help.');
        return;
      }
      uncertain = true;
      showError(`We couldn’t confirm whether your request arrived. Retry to check the same request using reference ${reference}. Editing is paused to avoid a duplicate; contact BTS with this reference if you need help.`);
    } catch (error) {
      if (attemptedPayload) uncertain = true;
      showError(attemptedPayload
        ? `We couldn’t confirm whether your request arrived${error.name === 'AbortError' ? ' before the connection timed out' : ''}. Retry the unchanged request using reference ${reference}, or contact BTS with this reference. Editing is paused to avoid a duplicate.`
        : 'Submission is temporarily unavailable. Your answers are still here. Try again shortly.');
    } finally { clearTimeout(timer); sending = false; controls(); }
  });
  form.querySelector('button[type="submit"]').disabled = false;
  controls(); checkAvailability();
})();
