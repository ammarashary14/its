(() => {
  'use strict';
  const api = window.BTSApplication;
  if (!api || !document.querySelector('#question-list')) return;
  const copy = value => JSON.parse(JSON.stringify(value));
  const saved = api.loadDraft();
  let state = copy(saved || api.defaultConfig);
  const list = document.querySelector('#question-list');
  const status = document.querySelector('#editor-status');
  const typeNames = { text: 'Short answer', email: 'Email address', textarea: 'Long answer', select: 'Dropdown choices', checkbox: 'Checkbox' };
  let timer;
  function announce(message, error = false) {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }
  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function renderPreview() {
    document.querySelector('#preview-title').textContent = state.title || 'Application title';
    document.querySelector('#preview-intro').textContent = state.intro;
    document.querySelector('#preview-submit').textContent = (state.submitLabel || 'Review application') + ' →';
    api.renderFields(document.querySelector('#preview-questions'), state, true);
    document.querySelector('#question-count').textContent = `${state.fields.length} / 30 questions`;
    document.querySelector('#add-question').disabled = state.fields.length >= 30;
  }
  function saveDraft() {
    clearTimeout(timer);
    timer = null;
    let clean;
    try { clean = api.validate(state); }
    catch (error) { announce(error.message + ' Your published application has not changed.', true); return null; }
    try {
      localStorage.setItem(api.storageKey, JSON.stringify(clean));
      announce('Draft saved on this device. Export it when you’re ready to publish.');
    } catch {
      announce('Browser storage is unavailable. Keep this tab open and export your draft to save it.', true);
    }
    return clean;
  }
  function changed() {
    renderPreview();
    announce('Saving draft…');
    clearTimeout(timer);
    timer = setTimeout(saveDraft, 250);
  }
  function labelledControl(field, setting, caption, controlTag = 'input') {
    const label = element('label', '', caption);
    const control = element(controlTag);
    control.id = `edit-${field.id}-${setting}`;
    label.htmlFor = control.id;
    control.dataset.setting = setting;
    label.append(control);
    return { label, control };
  }
  function renderQuestions(focusId, focusAction) {
    list.replaceChildren();
    state.fields.forEach((field, index) => {
      const core = field.id === 'name' || field.id === 'email';
      const card = element('article', 'editor-question');
      card.dataset.fieldId = field.id;
      const head = element('div', 'editor-question-head');
      head.append(element('h3', 'editor-question-title', `Question ${index + 1}${core ? ' · Essential' : ''}`));
      const actions = element('div', 'editor-question-actions');
      for (const [action, caption, disabled] of [['up', '↑', index === 0], ['down', '↓', index === state.fields.length - 1], ['remove', 'Remove', core]]) {
        const button = element('button', 'editor-small-button', caption);
        button.type = 'button'; button.dataset.action = action; button.disabled = disabled;
        button.setAttribute('aria-label', `${action === 'remove' ? 'Remove' : 'Move ' + action} question ${index + 1}`);
        actions.append(button);
      }
      head.append(actions); card.append(head);
      const label = labelledControl(field, 'label', 'Question text');
      label.control.value = field.label; label.control.maxLength = 200; label.control.required = true;
      card.append(label.label);
      const row = element('div', 'editor-question-row');
      const type = labelledControl(field, 'type', 'Answer type', 'select');
      for (const [value, name] of Object.entries(typeNames)) {
        const option = element('option', '', name); option.value = value; type.control.append(option);
      }
      type.control.value = field.type; type.control.disabled = core;
      row.append(type.label);
      if (field.type !== 'select' && field.type !== 'checkbox') {
        const limit = labelledControl(field, 'maxLength', 'Maximum answer length');
        limit.control.type = 'number'; limit.control.min = '1'; limit.control.max = '2000'; limit.control.value = field.maxLength || 500;
        row.append(limit.label);
      }
      card.append(row);
      if (field.type === 'select') {
        const choices = labelledControl(field, 'options', 'Choices — one per line', 'textarea');
        choices.control.value = (field.options || []).join('\n'); choices.control.rows = 4; choices.control.maxLength = 4530;
        card.append(choices.label);
      } else if (field.type !== 'checkbox') {
        const hint = labelledControl(field, 'placeholder', 'Answer hint (optional)');
        hint.control.value = field.placeholder || ''; hint.control.maxLength = 200;
        card.append(hint.label);
      }
      const required = element('label', 'editor-required');
      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.dataset.setting = 'required'; checkbox.checked = field.required; checkbox.disabled = core;
      required.append(checkbox, document.createTextNode('Answer required')); card.append(required);
      if (core) card.append(element('p', 'editor-locked', 'You can rename or move this question. Its answer type and required setting stay fixed.'));
      list.append(card);
    });
    if (focusId) {
      const row = [...list.children].find(card => card.dataset.fieldId === focusId);
      const target = focusAction ? row?.querySelector(`[data-action="${focusAction}"]`) : row?.querySelector('[data-setting="label"]');
      if (target && !target.disabled) target.focus();
      else row?.querySelector('[data-setting="label"]')?.focus();
    }
  }
  function renderAll() {
    document.querySelectorAll('[data-config]').forEach(input => { input.value = state[input.dataset.config]; });
    renderQuestions(); renderPreview();
  }
  document.querySelectorAll('[data-config]').forEach(input => input.addEventListener('input', () => {
    state[input.dataset.config] = input.value; changed();
  }));
  function updateQuestion(event) {
    const control = event.target.closest('[data-setting]');
    const card = control?.closest('[data-field-id]');
    if (!control || !card) return;
    const field = state.fields.find(item => item.id === card.dataset.fieldId);
    if (!field) return;
    const setting = control.dataset.setting;
    if ((field.id === 'name' || field.id === 'email') && ['type', 'required'].includes(setting)) return;
    if (setting === 'required') field.required = control.checked;
    else if (setting === 'maxLength') field.maxLength = Number(control.value);
    else if (setting === 'options') field.options = control.value.split('\n').map(value => value.trim()).filter(Boolean);
    else field[setting] = control.value;
    if (setting === 'type') {
      if (field.type === 'select' && !field.options?.length) field.options = ['Option 1', 'Option 2'];
      if (field.type !== 'select' && field.type !== 'checkbox' && !field.maxLength) field.maxLength = field.type === 'textarea' ? 500 : 200;
      renderQuestions(field.id);
    }
    changed();
  }
  list.addEventListener('input', updateQuestion);
  list.addEventListener('change', event => { if (['SELECT', 'INPUT'].includes(event.target.tagName) && (event.target.tagName === 'SELECT' || event.target.type === 'checkbox')) updateQuestion(event); });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    const card = button?.closest('[data-field-id]');
    if (!button || !card || button.disabled) return;
    const index = state.fields.findIndex(field => field.id === card.dataset.fieldId);
    if (index < 0) return;
    const field = state.fields[index];
    const action = button.dataset.action;
    if (action === 'remove') {
      if (field.id === 'name' || field.id === 'email') return;
      state.fields.splice(index, 1);
      renderQuestions(state.fields[Math.min(index, state.fields.length - 1)].id);
    } else {
      const destination = index + (action === 'up' ? -1 : 1);
      if (destination < 0 || destination >= state.fields.length) return;
      [state.fields[index], state.fields[destination]] = [state.fields[destination], state.fields[index]];
      renderQuestions(field.id, action);
    }
    renderPreview(); saveDraft();
  });
  document.querySelector('#add-question').addEventListener('click', () => {
    if (state.fields.length >= 30) return;
    const type = document.querySelector('#new-field-type').value;
    const suffix = window.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
    const field = { id: `question-${suffix}`, label: 'New question', type, required: false };
    if (type === 'select') field.options = ['Option 1', 'Option 2'];
    else if (type !== 'checkbox') { field.placeholder = ''; field.maxLength = type === 'textarea' ? 500 : 200; }
    state.fields.push(field); renderQuestions(field.id); renderPreview(); saveDraft();
  });
  document.querySelector('#export-draft').addEventListener('click', () => {
    const clean = saveDraft();
    if (!clean) { status.scrollIntoView?.({ block: 'center' }); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(clean, null, 2) + '\n'], { type: 'application/json' }));
    const link = element('a'); link.href = url; link.download = 'bts-volunteer-application.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Application exported. Share the downloaded file in our chat to publish these questions for everyone.');
  });
  const fileInput = document.querySelector('#import-file');
  document.querySelector('#import-draft').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error('Choose an application file smaller than 100 KB.');
      const imported = api.validate(JSON.parse(await file.text()));
      clearTimeout(timer); state = imported; renderAll(); saveDraft();
      announce('Draft imported and ready to edit. Export it when you’re ready to publish.');
    } catch (error) {
      announce(`Could not import that file. ${error instanceof SyntaxError ? 'Choose a valid application JSON file.' : error.message}`, true);
    } finally { fileInput.value = ''; }
  });
  document.querySelector('#reset-draft').addEventListener('click', () => {
    if (!window.confirm('Discard this device’s draft and restore the published application? Export first if you want to keep a copy.')) return;
    clearTimeout(timer); timer = null; state = copy(api.defaultConfig); renderAll();
    try { localStorage.removeItem(api.storageKey); announce('Draft cleared. You’re viewing the published application.'); }
    catch { announce('The editor is reset, but this browser could not clear storage. Export a copy before leaving.', true); }
  });
  window.addEventListener('pagehide', () => { if (timer) saveDraft(); });
  renderAll();
  announce(saved ? 'Your saved draft is ready. Changes stay on this device until published.' : 'Start with the published application. Changes will save as a draft on this device.');
})();
