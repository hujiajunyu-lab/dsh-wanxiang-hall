/**
 * store.js 的读写契约测试。
 *
 * 起点很小：schema 升级在 Step 1 才动手，这里先把「不认识的字段不许被吃掉、
 * 坏数据不许崩」这条底线钉住——迁移时的幂等性测试会接着长在这上面。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject, normalize, emptyState } from '../store.js';

test('activity 能原样穿过 normalize（心跳不许被吃掉）', () => {
  const p = normalizeProject('p1', {
    name: '甲',
    activity: { lastAt: 1700000000000, lastSize: 4096, nudges: 2, escalatedAt: 1700000001000 },
  });
  assert.deepEqual(p.activity, {
    lastAt: 1700000000000,
    lastSize: 4096,
    nudges: 2,
    escalatedAt: 1700000001000,
  });
});

test('没有 activity 的老项目补全为零值，不报错', () => {
  const p = normalizeProject('p1', { name: '甲' });
  assert.deepEqual(p.activity, { lastAt: null, lastSize: null, nudges: 0, escalatedAt: null });
});

test('activity 里塞垃圾也不崩', () => {
  const p = normalizeProject('p1', { activity: 'nope' });
  assert.equal(p.activity.nudges, 0);
  assert.equal(p.activity.lastAt, null);
});

test('normalize 幂等：同一份数据跑两遍结果一致', () => {
  const once = normalizeProject('p1', {
    name: '甲',
    status: 'zhongshu',
    activity: { lastAt: 1, lastSize: 2 },
    departments: { zhongshu: { sessionId: 'session-x', state: 'idle' } },
    milestones: [{ title: 'm', weight: 10, done: true }],
  });
  const twice = normalizeProject('p1', JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test('normalize 会把未知状态拉回 draft，不制造幽灵状态', () => {
  const p = normalizeProject('p1', { status: 'working' });
  assert.equal(p.status, 'draft');
});

test('emptyState 的 schema 是 v4（Step 1 编制化之后）', () => {
  assert.equal(emptyState().version, 4);
});
