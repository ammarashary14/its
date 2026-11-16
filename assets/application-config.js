(() => {
  'use strict';
  const storageKey = 'bts-application-draft-v1';
  const types = ['text', 'email', 'textarea', 'select', 'checkbox'];
  const defaultConfig = {
    "version": 1,
    "title": "Volunteer Application",
    "intro": "Please fill this to the best of your ability. You may be interviewed following review of your application.",
    "submitLabel": "Review application",
    "fields": [
      {
        "id": "name",
        "label": "Full name",
        "type": "text",
        "required": true,
        "placeholder": "",
        "maxLength": 100
      },
      {
        "id": "email",
        "label": "Email address",
        "type": "email",
        "required": true,
        "placeholder": "",
        "maxLength": 254
      },
      {
        "id": "city",
        "label": "City or area",
        "type": "text",
        "required": true,
        "placeholder": "",
        "maxLength": 80
      },
      {
        "id": "area",
        "label": "I’m interested in",
        "type": "select",
        "required": true,
        "options": [
          "Classroom volunteering",
          "Tutoring",
          "Both"
        ]
      },
      {
        "id": "grade",
        "label": "Preferred grade level",
        "type": "select",
        "required": true,
        "options": [
          "Grades 3–5",
          "Grades 6–8",
          "Grades 9–12",
          "Open to different grade levels"
        ]
      },
      {
        "id": "experience",
        "label": "Relevant experience",
        "type": "textarea",
        "required": true,
        "placeholder": "",
        "maxLength": 300
      },
      {
        "id": "availability",
        "label": "When are you usually available?",
        "type": "text",
        "required": true,
        "placeholder": "For example, weekday afternoons or Saturday mornings",
        "maxLength": 120
      },
      {
        "id": "motivation",
        "label": "Why would you like to volunteer with BTS?",
        "type": "textarea",
        "required": true,
        "placeholder": "",
        "maxLength": 500
      },
      {
        "id": "question-1df326a2",
        "label": "Awards or Honors",
        "type": "text",
        "required": true,
        "placeholder": "",
        "maxLength": 200
      },
      {
        "id": "consent",
        "label": "I agree that BTS may contact me about this application.",
        "type": "checkbox",
        "required": true
      }
    ]
  };
  const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'submit', 'reset', 'action', 'elements']);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function text(value, name, maximum, optional = false) {
    if (typeof value !== 'string') {
      if (optional && value === undefined) return '';
      throw new Error(`${name} must be text.`);
    }
    const result = value.trim();
    if ((!optional && !result) || result.length > maximum) throw new Error(`${name} must contain ${optional ? 'no more than ' + maximum : 'between 1 and ' + maximum} characters.`);
    return result;
  }
  function validate(value) {
    if (!isObject(value) || value.version !== 1) throw new Error('Choose a version 1 BTS application file.');
    if (!Array.isArray(value.fields) || value.fields.length < 2 || value.fields.length > 30) throw new Error('An application needs between 2 and 30 questions.');
    const ids = new Set();
    const config = {
      version: 1,
      title: text(value.title, 'Application title', 200),
      intro: text(value.intro, 'Introduction', 1500, true),
      submitLabel: text(value.submitLabel, 'Review button label', 60),
      fields: value.fields.map((field, index) => {
        if (!isObject(field)) throw new Error(`Question ${index + 1} is not valid.`);
        if (typeof field.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(field.id) || forbidden.has(field.id) || ids.has(field.id)) throw new Error(`Question ${index + 1} needs a unique, valid identifier.`);
        ids.add(field.id);
        if (!types.includes(field.type)) throw new Error(`Question ${index + 1} has an unsupported question type.`);
        if (typeof field.required !== 'boolean') throw new Error(`Question ${index + 1} needs a required setting.`);
        const clean = { id: field.id, label: text(field.label, `Question ${index + 1} label`, 200), type: field.type, required: field.required };
        if (field.type === 'select') {
          if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 30) throw new Error(`Question ${index + 1} needs 1–30 choices.`);
          clean.options = field.options.map(option => text(option, `Question ${index + 1} choice`, 150));
          if (new Set(clean.options).size !== clean.options.length) throw new Error(`Question ${index + 1} has duplicate choices.`);
        } else if (field.type !== 'checkbox') {
          clean.placeholder = text(field.placeholder, `Question ${index + 1} hint`, 200, true);
          const length = field.maxLength === undefined ? (field.type === 'textarea' ? 500 : 200) : field.maxLength;
          if (!Number.isInteger(length) || length < 1 || length > 2000) throw new Error(`Question ${index + 1} answer limit must be between 1 and 2,000.`);
          clean.maxLength = length;
        }
        if (field.id === 'name' && (clean.type !== 'text' || !clean.required)) throw new Error('The name question must remain a required short answer.');
        if (field.id === 'email' && (clean.type !== 'email' || !clean.required)) throw new Error('The email question must remain a required email address.');
        return clean;
      })
    };
    if (!ids.has('name') || !ids.has('email')) throw new Error('Keep the name and email questions so BTS can contact applicants.');
    return config;
  }
  function loadDraft() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved || saved.length > 100000) return null;
      return validate(JSON.parse(saved));
    } catch { return null; }
  }
  function make(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function renderFields(container, config, preview = false) {
    container.replaceChildren();
    config.fields.forEach(field => {
      const label = make('label', field.type === 'checkbox' ? 'check-label' : '');
      const control = make(field.type === 'textarea' ? 'textarea' : field.type === 'select' ? 'select' : 'input');
      const id = `${preview ? 'preview' : 'application'}-${field.id}`;
      control.id = id; control.name = field.id; control.dataset.label = field.label || 'Untitled question';
      control.required = field.required;
      control.disabled = preview;
      label.htmlFor = id;
      if (control.tagName === 'INPUT') control.type = field.type;
      if (field.type === 'select') {
        const empty = make('option', '', 'Choose an option'); empty.value = ''; control.append(empty);
        (field.options || []).forEach(option => control.append(make('option', '', option)));
      } else if (field.type === 'checkbox') {
        control.value = 'Yes';
      } else {
        control.maxLength = field.maxLength || 500;
        control.placeholder = field.placeholder || '';
        if (field.type === 'textarea') control.rows = 4;
        if (field.id === 'name') control.autocomplete = 'name';
        else if (field.id === 'email') control.autocomplete = 'email';
        else if (field.id === 'city') control.autocomplete = 'address-level2';
      }
      const caption = make('span', '', `${field.label || 'Untitled question'}${field.required ? ' *' : ' (optional)'}`);
      if (field.type === 'checkbox') label.append(control, caption);
      else label.append(caption, control);
      container.append(label);
    });
  }
  window.BTSApplication = { storageKey, defaultConfig, types, validate, loadDraft, renderFields };
})();
