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
  window.addEventListener('resize', () => { if (window.innerWidth > 1230) closeMenu(); });
  document.querySelectorAll('[data-year]').forEach(item => { item.textContent = new Date().getFullYear(); });

  // Illustrative curriculum. Replace these examples with approved BTS lessons.
  const lessons = {
    k2: {
      title: ['Shapes, patterns.', 'Little discoveries.'],
      description: 'Explore early math and science through familiar things. Young learners notice shapes and patterns, observe the natural world, and share what they discover.',
      skills: ['Shapes & patterns', 'Living things', 'Observation'],
      time: '20–30 MIN', activity: 'The wonder in everyday things',
      brief: 'Choose an everyday object. Look closely, draw what you notice, and share one question it makes you wonder about.',
      steps: ['Pick a familiar object, such as a leaf or pencil.', 'Look closely and draw three things you notice.', 'Share a question with a partner or the group.']
    },
    '35': {
      title: ['Numbers, nature.', 'Ideas in motion.'],
      description: 'Connect fractions and measurement with ideas from life science, earth science, and the forces around us. Learn by trying, observing, and explaining.',
      skills: ['Fractions & measurement', 'Life & earth science', 'Forces & motion'],
      time: '30–40 MIN', activity: 'Build a bridge of possibilities',
      brief: 'With paper and tape, work in a small team to build a bridge between two books. Test it, talk about it, and try a new idea.',
      steps: ['Draw a plan together using only paper and tape.', 'Build a bridge between two books and test it with a small object.', 'Change one part of the design and explain what you learned.']
    },
    '68': {
      title: ['Math that connects.', 'Science that clicks.'],
      description: 'Explore ratios and early algebra alongside biology, chemistry, and physics. Compare evidence, explain what you notice, and connect ideas across subjects.',
      skills: ['Ratios & algebra', 'Biology & chemistry', 'Physics'],
      time: '35–45 MIN', activity: 'What makes ice melt faster?',
      brief: 'Compare ice melting on two different surfaces. Make a prediction, keep the comparison fair, and use measurements to explain what happens.',
      steps: ['Place equal-sized ice cubes on two different room-temperature surfaces.', 'Record what changes at the same time intervals, keeping other conditions alike.', 'Compare your results and discuss heat transfer and any limits of the experiment.']
    },
    '912': {
      title: ['From equations', 'to explanations.'],
      description: 'Build understanding in algebra, geometry, biology, chemistry, and physics. Break down challenging concepts and use mathematical reasoning to explain scientific ideas.',
      skills: ['Algebra & geometry', 'Biology & chemistry', 'Physics'],
      time: '40–50 MIN', activity: 'Make sense of motion',
      brief: 'Sketch a distance–time graph for a short walk with a pause. Use the graph to connect mathematical slopes with physical motion.',
      steps: ['Plan a short walk that includes steady movement and a pause.', 'Sketch how distance from the start changes over time.', 'Explain the slopes and flat sections, and how the graph would change for a faster walk.']
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
