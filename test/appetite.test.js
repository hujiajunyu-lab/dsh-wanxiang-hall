import assert from 'node:assert/strict';
import { test } from 'node:test';

import { APPETITE_MS, normalizeAppetite, normalizeProject } from '../store.js';
import { appetiteBreach, appetiteOf, appetiteText } from '../activity.js';

const HOUR = 60 * 60 * 1000;

function project(overrides = {}) {
  return {
    id: 'p1',
    name: '样例',
    shape: 'squad',
    createdAt: 1_000_000,
    appetite: { maxMs: 4 * HOUR, startedAt: 1_000_000, breachedAt: null, extensions: [] },
    ...overrides,
  };
}

test('默认时长按编制给：轻量组 8 小时、项目组 40 小时、流水线不设限', () => {
  assert.equal(normalizeAppetite(null, 'squad', 5).maxMs, 8 * HOUR);
  assert.equal(normalizeAppetite(null, 'crew', 5).maxMs, 40 * HOUR);
  assert.equal(normalizeAppetite(null, 'line', 5).maxMs, 0);
  assert.equal(normalizeAppetite(null, 'whatever', 5).maxMs, APPETITE_MS.crew);
});

test('老项目没有 appetite 字段时，用 createdAt 当起点补一份', () => {
  const box = normalizeAppetite(undefined, 'squad', 1234567);
  assert.equal(box.maxMs, 8 * HOUR);
  assert.equal(box.startedAt, 1234567);
  assert.deepEqual(box.extensions, []);
});

test('延期记录保留最近 20 条，字段被夹紧', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ at: i, by: 'user', addMs: HOUR, note: 'x'.repeat(500) }));
  const box = normalizeAppetite({ maxMs: HOUR, extensions: many }, 'squad', 1);
  assert.equal(box.extensions.length, 20);
  assert.equal(box.extensions[0].at, 5);
  assert.equal(box.extensions[0].note.length, 200);
  assert.equal(box.extensions[0].by, 'user');
});

test('时间盒按「已用 / 剩多少」算，不按「估多久」', () => {
  const now = 1_000_000 + 1 * HOUR;
  const view = appetiteOf(project(), now);
  assert.equal(view.hours, 4);
  assert.equal(view.usedHours, 1);
  assert.equal(view.leftHours, 3);
  assert.equal(view.over, false);
  assert.match(appetiteText(project(), now), /还剩 3h/);
});

test('到点判超时，文案给出三个选项而不是无限做下去', () => {
  const now = 1_000_000 + 5 * HOUR;
  const view = appetiteOf(project(), now);
  assert.equal(view.over, true);
  assert.match(appetiteText(project(), now), /已用完/);
  assert.match(appetiteText(project(), now), /砍范围/);
});

test('没有时间盒的编制（流水线）不产生任何视图', () => {
  assert.equal(appetiteOf(project({ appetite: { maxMs: 0 } })), null);
  assert.equal(appetiteText(project({ appetite: { maxMs: 0 } })), '');
  assert.equal(appetiteBreach(project({ appetite: { maxMs: 0 } }), Date.now()), null);
});

test('超时只上报一次：已经报过就不再返回', () => {
  const now = 1_000_000 + 5 * HOUR;
  assert.ok(appetiteBreach(project(), now));
  assert.equal(appetiteBreach(project({ appetite: { maxMs: 4 * HOUR, startedAt: 1_000_000, breachedAt: now } }), now), null);
  assert.equal(appetiteBreach(project(), 1_000_000 + 1 * HOUR), null);
});

test('normalizeProject 会把时间盒带进项目，且不覆盖已有 maxMs', () => {
  const kept = normalizeProject('p1', { name: 'a', shape: 'crew', appetite: { maxMs: 3 * HOUR, startedAt: 10 } });
  assert.equal(kept.appetite.maxMs, 3 * HOUR);
  assert.equal(kept.appetite.startedAt, 10);

  const filled = normalizeProject('p2', { name: 'b', shape: 'squad', createdAt: 999 });
  assert.equal(filled.appetite.maxMs, 8 * HOUR);
  assert.equal(filled.appetite.startedAt, 999);
});
