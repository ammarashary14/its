const MIN_YEAR = 2000;
const MAX_YEAR = 2199;
const instances = new WeakMap();
const categories = { school: 'School visit', tutoring: 'Tutoring', volunteer: 'Volunteering', community: 'Community', other: 'BTS event' };
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function dateValue(key) { return new Date(`${key}T12:00:00Z`); }
function dateKey(year, month, day) { return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function button(text, className, label) {
  const element = node('button', className, text); element.type = 'button';
  if (label) element.setAttribute('aria-label', label);
  return element;
}
export function calendarToday(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function monthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1, 12));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  const cells = Array(offset).fill(null);
  for (let day = 1; day <= count; day++) cells.push(dateKey(year, month, day));
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function shiftCalendarMonth(key, amount) {
  const [year, month, day] = key.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + amount, 1, 12));
  if (next.getUTCFullYear() < MIN_YEAR || next.getUTCFullYear() > MAX_YEAR) return key;
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0, 12)).getUTCDate();
  return dateKey(next.getUTCFullYear(), next.getUTCMonth(), Math.min(day, lastDay));
}
function shiftDay(key, amount) {
  const next = dateValue(key); next.setUTCDate(next.getUTCDate() + amount);
  if (next.getUTCFullYear() < MIN_YEAR || next.getUTCFullYear() > MAX_YEAR) return key;
  return dateKey(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
}
export function visibleCalendarEvents(calendar) {
  return calendar.events.filter(event => event.visible).slice().sort((left, right) =>
    left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}
function eventTime(event) {
  if (!event.startTime) return 'All day';
  const format = value => timeFormatter.format(new Date(`2000-01-01T${value}:00Z`));
  return format(event.startTime) + (event.endTime ? ` – ${format(event.endTime)}` : '');
}
function eventCard(event, includeDate) {
  const article = node('article', 'calendar-event'); article.dataset.eventId = event.id;
  const meta = node('div', 'calendar-event-meta');
  meta.append(node('span', 'calendar-category', categories[event.category] || categories.other));
  const time = node('time', '', eventTime(event)); time.dateTime = event.date + (event.startTime ? `T${event.startTime}` : '');
  if (includeDate) {
    const date = node('time', 'calendar-event-date', shortDateFormatter.format(dateValue(event.date))); date.dateTime = event.date; article.append(date);
  }
  meta.append(time); article.append(meta, node('h3', '', event.title));
  if (event.location) article.append(node('p', 'calendar-event-location', event.location));
  if (event.description) article.append(node('p', 'calendar-event-description', event.description));
  if (event.url) {
    try {
      const url = new URL(event.url);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        const link = node('a', 'calendar-event-link', 'Event details ↗');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `Details for ${event.title} (opens in a new tab)`); article.append(link);
      }
    } catch { /* Invalid links cannot become navigation targets. */ }
  }
  return article;
}
function empty(text) { return node('p', 'calendar-empty', text); }

/** Content is validated by the shared site loader before reaching this view. */
export function renderCalendar(calendar, { root = document.querySelector('[data-calendar]'), now = new Date() } = {}) {
  if (!root) return;
  const today = calendarToday(calendar.timeZone, now);
  let state = instances.get(root);
  if (!state) {
    state = { selected: today, calendar, today, upcomingExpanded: false };
    instances.set(root, state);
  }
  state.calendar = calendar; state.today = today;
  draw(root, state);
}
function draw(root, state, focusDate = false) {
  const document = root.ownerDocument;
  const focused = root.contains(document.activeElement) ? document.activeElement : null;
  const focusedDate = focused?.dataset.calendarDate;
  const focusedAction = focused?.dataset.calendarAction;
  const [year, month] = state.selected.split('-').map(Number);
  const events = visibleCalendarEvents(state.calendar);
  const byDate = new Map();
  events.forEach(event => { if (!byDate.has(event.date)) byDate.set(event.date, []); byDate.get(event.date).push(event); });
  const layout = node('div', 'calendar-layout');
  const monthPanel = node('section', 'calendar-month-panel'); monthPanel.setAttribute('aria-labelledby', 'calendar-month-title');
  const toolbar = node('div', 'calendar-toolbar');
  const monthTitle = node('h2', '', monthFormatter.format(dateValue(state.selected))); monthTitle.id = 'calendar-month-title';
  const controls = node('div', 'calendar-controls');
  const previous = button('‹', 'calendar-arrow', 'Previous month'); previous.dataset.calendarAction = 'previous'; previous.disabled = year === MIN_YEAR && month === 1;
  const next = button('›', 'calendar-arrow', 'Next month'); next.dataset.calendarAction = 'next'; next.disabled = year === MAX_YEAR && month === 12;
  const today = button('Today', 'calendar-today'); today.dataset.calendarAction = 'today';
  function select(key, moveFocus = false) { state.selected = key; state.today = calendarToday(state.calendar.timeZone); draw(root, state, moveFocus); }
  function navigate(amount, action) {
    select(shiftCalendarMonth(state.selected, amount));
    const control = root.querySelector(`[data-calendar-action="${action}"]`);
    (control && !control.disabled ? control : root.querySelector('[aria-pressed="true"]'))?.focus({ preventScroll: true });
  }
  previous.addEventListener('click', () => navigate(-1, 'previous'));
  next.addEventListener('click', () => navigate(1, 'next'));
  today.addEventListener('click', () => select(calendarToday(state.calendar.timeZone), true));
  controls.append(previous, today, next); toolbar.append(monthTitle, controls); monthPanel.append(toolbar);
  const table = node('table', 'calendar-table');
  const caption = node('caption', 'calendar-sr-only', `${monthTitle.textContent}. Select a date to see its events. Use arrow keys to move between dates.`); table.append(caption);
  const head = node('thead'); const headings = node('tr');
  weekdays.forEach(day => { const cell = node('th'); cell.scope = 'col'; const abbreviation = node('abbr', '', day.slice(0, 3)); abbreviation.title = day; cell.append(abbreviation); headings.append(cell); });
  head.append(headings); table.append(head);
  const body = node('tbody'); const cells = monthCells(year, month - 1);
  for (let index = 0; index < cells.length; index += 7) {
    const row = node('tr');
    cells.slice(index, index + 7).forEach(key => {
      const cell = node('td');
      if (key) {
        const dayEvents = byDate.get(key) || [];
        const label = dateFormatter.format(dateValue(key)) + (dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ', no events');
        const day = button('', 'calendar-day', label); day.dataset.calendarDate = key;
        day.tabIndex = key === state.selected ? 0 : -1;
        day.setAttribute('aria-pressed', String(key === state.selected));
        if (key === state.today) day.setAttribute('aria-current', 'date');
        day.append(node('span', 'calendar-day-number', String(Number(key.slice(8)))));
        if (dayEvents.length) {
          const count = node('span', 'calendar-day-events'); count.setAttribute('aria-hidden', 'true');
          count.append(node('span', 'calendar-event-dot'), node('span', 'calendar-event-count', `${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`)); day.append(count);
        }
        day.addEventListener('click', () => select(key, true));
        day.addEventListener('keydown', event => {
          if (event.altKey || event.metaKey || event.ctrlKey) return;
          let target;
          if (event.key === 'ArrowLeft') target = shiftDay(key, -1);
          if (event.key === 'ArrowRight') target = shiftDay(key, 1);
          if (event.key === 'ArrowUp') target = shiftDay(key, -7);
          if (event.key === 'ArrowDown') target = shiftDay(key, 7);
          if (event.key === 'Home') target = shiftDay(key, -((dateValue(key).getUTCDay() + 6) % 7));
          if (event.key === 'End') target = shiftDay(key, 6 - ((dateValue(key).getUTCDay() + 6) % 7));
          if (event.key === 'PageUp') target = shiftCalendarMonth(key, -1);
          if (event.key === 'PageDown') target = shiftCalendarMonth(key, 1);
          if (target) { event.preventDefault(); select(target, true); }
        });
        cell.append(day);
      } else { cell.className = 'calendar-day-outside'; cell.setAttribute('aria-hidden', 'true'); }
      row.append(cell);
    });
    body.append(row);
  }
  table.append(body); monthPanel.append(table);
  const zone = node('p', 'calendar-timezone', `All times shown in ${state.calendar.timeZone.replace(/_/g, ' ')}.`);
  monthPanel.append(zone);
  const agenda = node('section', 'calendar-agenda'); agenda.setAttribute('aria-labelledby', 'calendar-agenda-title');
  agenda.append(node('p', 'eyebrow', 'SELECTED DATE'));
  const agendaTitle = node('h2', '', shortDateFormatter.format(dateValue(state.selected))); agendaTitle.id = 'calendar-agenda-title';
  const selectedEvents = byDate.get(state.selected) || [];
  const agendaSummary = node('p', 'calendar-agenda-summary', `${dateFormatter.format(dateValue(state.selected))} · ${selectedEvents.length} event${selectedEvents.length === 1 ? '' : 's'}`);
  agenda.append(agendaTitle, agendaSummary);
  if (!selectedEvents.length) agenda.append(empty('No events are scheduled for this date. Choose another day or explore what’s coming up.'));
  else {
    const list = node('ul', 'calendar-agenda-list');
    selectedEvents.forEach(event => { const item = node('li'); item.append(eventCard(event, false)); list.append(item); }); agenda.append(list);
  }
  layout.append(monthPanel, agenda);
  const upcoming = node('section', 'calendar-upcoming'); upcoming.setAttribute('aria-labelledby', 'calendar-upcoming-title');
  const upcomingHeading = node('div', 'calendar-upcoming-heading'); const upcomingTitle = node('h2', '', 'Coming up.'); upcomingTitle.id = 'calendar-upcoming-title';
  const future = events.filter(event => event.date >= state.today);
  upcomingHeading.append(upcomingTitle, node('p', '', future.length ? `From ${shortDateFormatter.format(dateValue(state.today))}` : 'New dates will appear here when they’re announced.')); upcoming.append(upcomingHeading);
  if (!future.length) upcoming.append(empty(events.length ? 'There are no upcoming events scheduled. Check back for our next dates.' : 'No events have been announced yet. Check back for school visits, tutoring sessions, and community updates.'));
  else {
    const list = node('ol', 'calendar-upcoming-list');
    (state.upcomingExpanded ? future : future.slice(0, 6)).forEach(event => { const item = node('li'); item.append(eventCard(event, true)); list.append(item); }); upcoming.append(list);
    if (future.length > 6) {
      const more = button(state.upcomingExpanded ? 'Show fewer events' : `Show all ${future.length} upcoming events`, 'calendar-more');
      more.dataset.calendarAction = 'more';
      more.setAttribute('aria-expanded', String(state.upcomingExpanded)); more.addEventListener('click', () => { state.upcomingExpanded = !state.upcomingExpanded; draw(root, state); root.querySelector('.calendar-more')?.focus(); }); upcoming.append(more);
    }
  }
  root.replaceChildren(layout, upcoming);
  const announcement = document.querySelector('[data-calendar-announcement]');
  if (announcement) announcement.textContent = agendaSummary.textContent;
  let focusTarget = focusDate || focusedDate ? root.querySelector(`[data-calendar-date="${state.selected}"]`) : focusedAction ? root.querySelector(`[data-calendar-action="${focusedAction}"]`) : null;
  if (focusTarget?.disabled) focusTarget = root.querySelector(`[data-calendar-date="${state.selected}"]`);
  focusTarget?.focus({ preventScroll: true });
}
export function showCalendarUnavailable(root = document.querySelector('[data-calendar]')) {
  if (!root) return;
  const message = empty('The calendar could not be loaded. Refresh this page, or contact BTS for event information.'); message.setAttribute('role', 'status');
  const link = node('a', 'calendar-event-link', 'Contact BTS ↗'); link.href = 'contact.html';
  root.replaceChildren(message, link);
  const announcement = root.ownerDocument.querySelector('[data-calendar-announcement]');
  if (announcement) announcement.textContent = message.textContent;
}
