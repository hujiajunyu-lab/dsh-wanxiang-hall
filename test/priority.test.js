import test from 'node:test';
import assert from 'node:assert/strict';

const STATE_DIR = await (async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  return fs.mkdtemp(path.join(os.tmpdir(), 'court-priority-'));
})();
process.env.COURT_STATE_DIR = STATE_DIR;

const {
  normalizePriority,
  normalizeProject,
  quadrantOf,
  QUADRANTS,
} = await import('../store.js');

test('优先级默认既不重要也不紧急', () => {
  assert.deepEqual(normalizePriority(undefined), { important: false, urgent: false });
  assert.deepEqual(normalizePriority(null), { important: false, urgent: false });
  assert.deepEqual(normalizePriority({}), { important: false, urgent: false });
});

test('优先级只认 true，字符串/falsy 一律当 false', () => {
  assert.deepEqual(normalizePriority({ important: 'true', urgent: 1 }), { important: false, urgent: false });
  assert.deepEqual(normalizePriority({ important: true, urgent: false }), { important: true, urgent: false });
});

test('四象限映射与顺序一致', () => {
  assert.equal(quadrantOf({ important: true, urgent: true }), 'important-urgent');
  assert.equal(quadrantOf({ important: true, urgent: false }), 'important-not-urgent');
  assert.equal(quadrantOf({ important: false, urgent: true }), 'urgent-not-important');
  assert.equal(quadrantOf({ important: false, urgent: false }), 'neither');
  assert.deepEqual(QUADRANTS, [
    'important-not-urgent',
    'important-urgent',
    'neither',
    'urgent-not-important',
  ]);
});

test('quadrantOf 既能吃项目也能吃裸 priority', () => {
  assert.equal(quadrantOf({ priority: { important: true, urgent: true } }), 'important-urgent');
  assert.equal(quadrantOf({ important: true, urgent: true }), 'important-urgent');
  assert.equal(quadrantOf(undefined), 'neither');
});

test('normalizeProject 保留优先级并补默认值', () => {
  const withPriority = normalizeProject('p1', {
    name: '有优先级',
    priority: { important: true, urgent: false },
  });
  assert.deepEqual(withPriority.priority, { important: true, urgent: false });

  const without = normalizeProject('p2', { name: '没填' });
  assert.deepEqual(without.priority, { important: false, urgent: false });
  assert.equal(quadrantOf(without), 'neither');
});

test('normalizeProject 幂等：两轮结果一致', () => {
  const once = normalizeProject('p3', {
    name: '幂等',
    priority: { important: true, urgent: true },
  });
  const twice = normalizeProject('p3', JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice.priority, once.priority);
  assert.equal(quadrantOf(twice), 'important-urgent');
});
