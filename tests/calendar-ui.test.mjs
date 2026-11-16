import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarToday, monthCells, shiftCalendarMonth, visibleCalendarEvents } from '../assets/calendar.js';

test('Today follows the configured calendar zone at a date boundary', () => {
  const instant = new Date('2026-12-01T00:30:00Z');
  assert.equal(calendarToday('UTC', instant), '2026-12-01');
  assert.equal(calendarToday('America/Los_Angeles', instant), '2026-11-30');
  assert.equal(calendarToday('Asia/Tokyo', instant), '2026-12-01');
});
test('month cells use literal dates and Monday-first weeks across leap years', () => {
  const february = monthCells(2026, 1);
  assert.deepEqual(february.slice(0, 7), [null, null, null, null, null, null, '2026-02-01']);
  assert.equal(february.length % 7, 0);
  assert.equal(monthCells(2024, 1).filter(Boolean).length, 29);
  assert.equal(monthCells(2100, 1).filter(Boolean).length, 28);
  assert.equal(monthCells(2104, 1).filter(Boolean).length, 29);
  assert.equal(monthCells(2026, 10).filter(Boolean)[0], '2026-11-01');
  assert.equal(monthCells(2026, 10).filter(Boolean).at(-1), '2026-11-30');
});
test('month navigation clamps dates and respects the supported calendar bounds', () => {
  assert.equal(shiftCalendarMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(shiftCalendarMonth('2023-01-31', 1), '2023-02-28');
  assert.equal(shiftCalendarMonth('2026-12-15', 1), '2027-01-15');
  assert.equal(shiftCalendarMonth('2026-01-15', -1), '2025-12-15');
  assert.equal(shiftCalendarMonth('2000-01-01', -1), '2000-01-01');
  assert.equal(shiftCalendarMonth('2199-12-31', 1), '2199-12-31');
});
test('published event ordering hides private entries and keeps all-day events first', () => {
  const events = [
    { id: 'late', title: 'Afternoon', date: '2026-11-20', startTime: '14:00', visible: true },
    { id: 'hidden', title: 'Private session', date: '2026-11-19', startTime: '', visible: false },
    { id: 'early', title: 'Morning', date: '2026-11-20', startTime: '09:00', visible: true },
    { id: 'all-day', title: 'All day', date: '2026-11-20', startTime: '', visible: true },
    { id: 'tomorrow', title: 'Tomorrow', date: '2026-11-21', startTime: '', visible: true }
  ];
  const original = structuredClone(events);
  assert.deepEqual(visibleCalendarEvents({ events }).map(event => event.id), ['all-day', 'early', 'late', 'tomorrow']);
  assert.deepEqual(events, original);
  assert.deepEqual(visibleCalendarEvents({ events: [] }), []);
});
