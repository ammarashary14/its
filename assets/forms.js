(() => {
  'use strict';
  const form = document.querySelector('[data-email-form]');
  if (!form) return;

  const volunteer = form.dataset.kind === 'volunteer';
  const recipient = volunteer ? 'breakingtheskyadmissions@gmail.com' : 'ammarashary@gmail.com';
  const review = document.querySelector('#application-review');
  const summary = review.querySelector('.review-summary');
  const sendLink = document.querySelector('#send-email');
  const emailHelp = document.querySelector('#email-help');
  const status = document.querySelector('#copy-status');
  const editButton = document.querySelector('#edit-details');
  const copyButton = document.querySelector('#copy-details');
  const sendButton = document.querySelector('#send-application');
  const errorBox = document.querySelector('#submission-error');
  const submissionStatus = document.querySelector('#submission-status');
  const fallback = document.querySelector('#submission-fallback');
  const success = document.querySelector('#application-success');
  const subject = volunteer ? 'Volunteer application — Breaking the Sky' : '1-on-1 tutoring request — Breaking the Sky';
  let message = '';
  let sending = false;
  let submitted = false;
  let reference = '';
  const isDraft = () => volunteer && form.dataset.draft === 'true';
  // Resolve the delivery route before review; a failed POST never switches providers.
  let deliveryMode = volunteer ? null : 'email';
  const deliveryReady = volunteer ? (async () => {
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('api/applications', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const data = response.ok ? await response.json() : null;
      deliveryMode = data?.enabled === true ? 'cloudflare' : 'formsubmit';
    } catch { deliveryMode = 'formsubmit'; }
    finally { window.clearTimeout(timer); }
    if (deliveryMode === 'cloudflare') {
      const notice = document.querySelector('#application-delivery-notice');
      if (notice) notice.textContent = 'BTS stores your application for the team to review and contact you about the outcome. Your answers are not saved in this browser.';
    }
  })() : Promise.resolve();
  let preparingReview = false;

  form.querySelectorAll('input, textarea, select').forEach(field => {
    field.addEventListener('input', () => field.setCustomValidity(''));
    field.addEventListener('change', () => field.setCustomValidity(''));
  });
  // The fallback button is disabled in the HTML until this handler is available.
  form.querySelector('button[type="submit"]')?.removeAttribute('disabled');

  function prepareEmailFallback() {
    const subjectUrl = `mailto:${recipient}?subject=${encodeURIComponent(subject)}`;
    const fullUrl = `${subjectUrl}&body=${encodeURIComponent(message)}`;
    const requiresPaste = fullUrl.length > 1900;
    sendLink.href = requiresPaste ? subjectUrl : fullUrl;
    sendLink.replaceChildren(document.createTextNode(requiresPaste ? 'Open email & paste details ' : 'Open email to send '));
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗'; sendLink.append(arrow);
    if (!volunteer) {
      emailHelp.textContent = requiresPaste
        ? 'This is a longer message. Copy your details below, then open your email app, paste them, and send. Nothing has been sent yet.'
        : 'Nothing has been sent yet. The next button opens a prefilled email for you to review and send.';
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || submitted || preparingReview) return;
    if (volunteer && deliveryMode === null) {
      preparingReview = true;
      const reviewButton = form.querySelector('button[type="submit"]');
      reviewButton.disabled = true;
      await deliveryReady;
      reviewButton.disabled = false;
      preparingReview = false;
      // The delivery notice is now accurate. Keep the form visible for review.
      if (deliveryMode === 'cloudflare') {
        const notice = document.querySelector('#application-delivery-notice');
        if (notice) { notice.tabIndex = -1; notice.focus(); }
        return;
      }
    }
    form.querySelectorAll('input:not([type="checkbox"]), textarea').forEach(field => {
      field.value = field.value.trim();
      field.setCustomValidity(field.required && !field.value ? 'Please enter a value, not just spaces.' : '');
    });
    form.querySelectorAll('[data-required-group]').forEach(group => {
      const inputs = [...group.querySelectorAll('input[type="checkbox"]')];
      if (inputs.length) inputs[0].setCustomValidity(inputs.some(input => input.checked) ? '' : 'Please choose at least one option.');
    });
    if (!form.reportValidity()) return;

    const entries = [...form.querySelectorAll('[data-label]')].map(field => {
      const value = field.type === 'checkbox' ? (field.checked ? field.value : 'Not selected') : field.value.trim();
      return `${field.dataset.label}: ${value || 'Not provided'}`;
    });
    if (volunteer && !reference) {
      reference = 'BTS-' + (window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).toUpperCase();
    }
    message = [subject, ...(volunteer ? [`Application reference: ${reference}`] : []), '', ...entries].join('\n\n');
    summary.textContent = message;
    prepareEmailFallback();
    if (volunteer) {
      errorBox.hidden = true; fallback.hidden = true; submissionStatus.textContent = '';
      sendButton.disabled = isDraft();
      emailHelp.textContent = isDraft()
        ? 'This is a local draft preview. Nothing can be sent from this preview. Open the published application to apply.'
        : 'Nothing has been sent yet. Submit below to send your application directly to BTS.';
      document.querySelector('#published-application-link').hidden = !isDraft();
    }
    status.textContent = '';
    form.hidden = true; review.hidden = false;
    document.querySelector('#review-title').focus();
    review.scrollIntoView?.({ behavior: 'auto', block: 'start' });
  });

  editButton.addEventListener('click', () => {
    if (sending || submitted) return;
    review.hidden = true; form.hidden = false; status.textContent = '';
    form.querySelector('input, select, textarea').focus();
  });

  copyButton.addEventListener('click', async () => {
    if (sending || submitted) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(message);
      status.textContent = volunteer ? 'Application details copied.' : 'Details copied. Paste them into your email and send it to ammarashary@gmail.com.';
    } catch {
      const selection = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(summary); selection?.removeAllRanges(); selection?.addRange(range); summary.focus();
      status.textContent = 'Your details are selected. Use Copy to copy them.';
    }
  });

  if (!volunteer || !sendButton) return;
  sendButton.addEventListener('click', async () => {
    if (sending || submitted || isDraft() || !message || review.hidden) return;
    if (form.querySelector('[name="_honey"]')?.value) {
      errorBox.textContent = 'We couldn’t submit this application. Please contact BTS if this keeps happening.';
      errorBox.hidden = false; fallback.hidden = false; errorBox.focus(); return;
    }
    sending = true;
    sendButton.disabled = true; editButton.disabled = true; copyButton.disabled = true;
    sendButton.textContent = 'Submitting…'; review.setAttribute('aria-busy', 'true');
    errorBox.hidden = true; fallback.hidden = true; submissionStatus.textContent = 'Submitting your application. Please keep this page open.';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25000);
    try {
      const cloudflare = deliveryMode === 'cloudflare';
      const name = form.querySelector('[name="name"]').value.trim();
      const email = form.querySelector('[name="email"]').value.trim();
      const payload = cloudflare ? { reference, name, email, message, honey: '' } : {
        _subject: subject, _template: 'table', _url: new URL('apply.html', document.baseURI).href, _honey: '',
        name, email, 'Application reference': reference, 'Application details': message
      };
      const response = await fetch(cloudflare ? 'api/applications' : `https://formsubmit.co/ajax/${recipient}`, {
        method: 'POST', credentials: cloudflare ? 'same-origin' : 'omit', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload)
      });
      const result = await response.json();
      const accepted = result && (result.success === true || result.success === 'true');
      const needsSetup = /activat|confirm.{0,25}(email|address)|verify.{0,25}(email|address)|not.{0,12}configured/i.test(String(result?.message || ''));
      if (!response.ok || !accepted || needsSetup) throw new Error('Submission not accepted');
      submitted = true;
      form.reset(); form.replaceChildren(); summary.textContent = ''; message = '';
      sendLink.removeAttribute('href'); status.textContent = ''; submissionStatus.textContent = '';
      review.hidden = true; success.hidden = false;
      document.querySelector('#submission-reference').textContent = reference;
      document.querySelector('#success-title').focus();
      success.scrollIntoView?.({ behavior: 'auto', block: 'start' });
    } catch (error) {
      errorBox.textContent = error.name === 'AbortError'
        ? 'The request timed out, so we couldn’t confirm whether your application arrived. Your answers are still here. You can try again with the same reference, or contact BTS to check before resending.'
        : 'We couldn’t confirm your submission. Your answers are still here. Try again, or copy your application and email BTS. If you already tried submitting, include the same reference so we can check for a duplicate.';
      errorBox.hidden = false; fallback.hidden = false; submissionStatus.textContent = ''; errorBox.focus();
    } finally {
      window.clearTimeout(timeout); sending = false; review.removeAttribute('aria-busy');
      sendButton.disabled = submitted || isDraft(); editButton.disabled = submitted; copyButton.disabled = submitted;
      sendButton.textContent = submitted ? 'Application submitted' : 'Submit application';
    }
  });
})();
