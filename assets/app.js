(() => {
  'use strict';
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#site-nav');
  const closeMenu = () => {
    navigation?.classList.remove('is-open');
    menuButton?.setAttribute('aria-expanded', 'false');
  };
  menuButton?.addEventListener('click', () => {
    const expanded = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(expanded));
    navigation?.classList.toggle('is-open', expanded);
  });
  navigation?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuButton.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.site-header')) closeMenu();
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 950) closeMenu(); });
  document.querySelectorAll('[data-year]').forEach(item => { item.textContent = new Date().getFullYear(); });

  // Illustrative curriculum. Replace these examples with approved BTS lessons.
  const lessons = {
    k2: {
      title: ['Small discoveries.', 'Big little wonders.'],
      description: 'Start with the everyday and make room for the unexpected. Young learners practice noticing, wondering, and sharing their ideas.',
      skills: ['Observation', 'Curiosity', 'Sharing ideas'],
      time: '20–30 MIN', activity: 'The wonder in everyday things',
      brief: 'Choose an everyday object. Look closely, draw what you notice, and share one question it makes you wonder about.',
      steps: ['Pick a familiar object, such as a leaf or pencil.', 'Look closely and draw three things you notice.', 'Share a question with a partner or the group.']
    },
    '35': {
      title: ['A spark of an idea.', 'A chance to create.'],
      description: 'Let curiosity become something you can build. Learners work together, try out ideas, and discover that there is more than one way to solve a problem.',
      skills: ['Creative thinking', 'Teamwork', 'Explaining choices'],
      time: '30–40 MIN', activity: 'Build a bridge of possibilities',
      brief: 'With paper and tape, work in a small team to build a bridge between two books. Test it, talk about it, and try a new idea.',
      steps: ['Draw a plan together using only paper and tape.', 'Build a bridge between two books and test it with a small object.', 'Change one part of the design and explain what you learned.']
    },
    '68': {
      title: ['More perspectives.', 'Better questions.'],
      description: 'Make room for different ways of thinking. Learners examine a familiar challenge, compare ideas, and practice backing up their reasoning.',
      skills: ['Reasoning', 'Discussion', 'Perspective-taking'],
      time: '35–45 MIN', activity: 'One challenge, many viewpoints',
      brief: 'Imagine a school wants to improve a shared space. Explore what different people might need, then compare possible solutions.',
      steps: ['Choose a shared space, such as a library or playground.', 'Consider the needs of students, teachers, and others who use it.', 'Compare two improvements and explain the trade-offs.']
    },
    '912': {
      title: ['A bigger picture.', 'A way forward.'],
      description: 'Connect classroom thinking to the world beyond it. Learners identify a real need, explore what matters, and turn an idea into a practical first step.',
      skills: ['Research', 'Communication', 'Planning'],
      time: '40–50 MIN', activity: 'A small plan for a real change',
      brief: 'Identify a need in your school or community. Sketch a response, consider the people it affects, and build a short proposal.',
      steps: ['Choose a need and list what you know and still need to learn.', 'Outline one possible response, including resources and people involved.', 'Share a short proposal with a first step and a way to evaluate it.']
    }
  };
  const gradeTabs = [...document.querySelectorAll('[data-grade]')];
  const panel = document.querySelector('#grade-panel');
  const stepsToggle = document.querySelector('.lesson-toggle');
  const stepsList = document.querySelector('#lesson-steps');
  function setStepsExpanded(expanded) {
    if (!stepsToggle || !stepsList) return;
    stepsToggle.setAttribute('aria-expanded', String(expanded));
    stepsList.hidden = !expanded;
    stepsToggle.replaceChildren(document.createTextNode(expanded ? 'Hide the activity steps ' : 'See the activity steps '));
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = expanded ? '−' : '+';
    stepsToggle.append(icon);
  }
  function selectGrade(tab) {
    const lesson = lessons[tab.dataset.grade];
    if (!lesson || !panel) return;
    gradeTabs.forEach(item => {
      item.setAttribute('aria-selected', String(item === tab));
      item.tabIndex = item === tab ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tab.id);
    const title = document.querySelector('#lesson-title');
    title.replaceChildren(document.createTextNode(lesson.title[0]), document.createElement('br'), document.createTextNode(lesson.title[1]));
    document.querySelector('#lesson-description').textContent = lesson.description;
    document.querySelector('#lesson-skills').replaceChildren(...lesson.skills.map(skill => {
      const tag = document.createElement('span'); tag.textContent = skill; return tag;
    }));
    document.querySelector('#activity-time').textContent = lesson.time;
    document.querySelector('#activity-title').textContent = lesson.activity;
    document.querySelector('#activity-description').textContent = lesson.brief;
    stepsList.replaceChildren(...lesson.steps.map(step => {
      const item = document.createElement('li'); item.textContent = step; return item;
    }));
    setStepsExpanded(false);
  }
  gradeTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectGrade(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % gradeTabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + gradeTabs.length) % gradeTabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = gradeTabs.length - 1;
      else return;
      event.preventDefault(); selectGrade(gradeTabs[next]); gradeTabs[next].focus();
    });
  });
  stepsToggle?.addEventListener('click', () => setStepsExpanded(stepsToggle.getAttribute('aria-expanded') !== 'true'));

})();
