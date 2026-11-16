(() => {
  'use strict';
  const form = document.querySelector('[data-email-form]');
  if (!form) return;

  const recipient = 'ammarashary@gmail.com';
  const review = document.querySelector('#application-review');
  const summary = review.querySelector('.review-summary');
  const sendLink = document.querySelector('#send-email');
  const emailHelp = document.querySelector('#email-help');
  const status = document.querySelector('#copy-status');
  const subject = form.dataset.kind === 'volunteer'
    ? 'Volunteer application — Breaking the Sky'
    : 'Tutoring request — Breaking the Sky';
  let message = '';

  form.querySelectorAll('input, textarea, select').forEach(field => {
    field.addEventListener('input', () => field.setCustomValidity(''));
    field.addEventListener('change', () => field.setCustomValidity(''));
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
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
      const value = field.type === 'checkbox'
        ? (field.checked ? field.value : 'Not selected')
        : field.value.trim();
      return `${field.dataset.label}: ${value || 'Not provided'}`;
    });
    message = [subject, '', ...entries].join('\n\n');
    summary.textContent = message;
    const subjectUrl = `mailto:${recipient}?subject=${encodeURIComponent(subject)}`;
    const fullUrl = `${subjectUrl}&body=${encodeURIComponent(message)}`;
    const requiresPaste = fullUrl.length > 1900;
    sendLink.href = requiresPaste ? subjectUrl : fullUrl;
    sendLink.replaceChildren(document.createTextNode(requiresPaste ? 'Open email & paste details ' : 'Open email to send '));
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    sendLink.append(arrow);
    emailHelp.textContent = requiresPaste
      ? 'This is a longer message. Copy your details below, then open your email app, paste them, and send. Nothing has been sent yet.'
      : 'Nothing has been sent yet. The next button opens a prefilled email for you to review and send.';
    status.textContent = '';
    form.hidden = true;
    review.hidden = false;
    document.querySelector('#review-title').focus();
    review.scrollIntoView?.({ behavior: 'auto', block: 'start' });
  });

  document.querySelector('#edit-details').addEventListener('click', () => {
    review.hidden = true;
    form.hidden = false;
    status.textContent = '';
    form.querySelector('input, select, textarea').focus();
  });

  document.querySelector('#copy-details').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(message);
      status.textContent = 'Details copied. Paste them into your email and send it to ammarashary@gmail.com.';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(summary);
      selection?.removeAllRanges();
      selection?.addRange(range);
      summary.focus();
      status.textContent = 'Your details are selected. Use Copy, then paste them into an email to ammarashary@gmail.com.';
    }
  });
})();
