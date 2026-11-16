(() => {
  'use strict';
  const api = window.BTSApplication;
  const form = document.querySelector('[data-email-form][data-kind="volunteer"]');
  if (!api || !form) return;
  const publishedOnly = new URLSearchParams(window.location.search).get('published') === '1';
  const draft = publishedOnly ? null : api.loadDraft();
  const config = draft || api.validate(api.defaultConfig);
  document.querySelector('#application-title').textContent = config.title;
  document.querySelector('.form-page-intro .lead').textContent = config.intro;
  form.replaceChildren();
  const help = document.createElement('p');
  help.className = 'form-help'; help.textContent = 'Fields marked with * are required.';
  const questions = document.createElement('div'); questions.className = 'application-questions';
  api.renderFields(questions, config);
  const privacy = document.createElement('p');
  privacy.className = 'form-help'; privacy.textContent = 'Your answers stay on this page until you choose to copy them or open an email. Nothing is sent automatically.';
  const submit = document.createElement('button');
  submit.className = 'button'; submit.type = 'submit'; submit.textContent = config.submitLabel + ' →';
  form.append(help, questions, privacy, submit);
  if (draft) {
    const note = document.createElement('aside');
    note.className = 'application-draft-notice';
    note.setAttribute('aria-label', 'Application draft preview');
    const strong = document.createElement('strong'); strong.textContent = 'Your local application draft';
    const description = document.createElement('p'); description.textContent = 'Only this browser sees these questions. Export your draft from the editor to publish it for everyone.';
    const editor = document.createElement('a'); editor.href = 'editor.html'; editor.textContent = 'Continue editing';
    const published = document.createElement('a'); published.href = 'apply.html?published=1'; published.textContent = 'View published application';
    const actions = document.createElement('div'); actions.className = 'draft-notice-actions'; actions.append(editor, published);
    note.append(strong, description, actions);
    document.querySelector('.form-layout').before(note);
  }
})();
