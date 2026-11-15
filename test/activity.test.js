/**
 * activity.js 的回归测试 —— 零依赖，`node --test` 直接跑。
 *
 * 这里锁的是「面板凭什么说它在动/没动」：心跳读的是会话日志文件的写入时间，
 * 不是角色自报。任何一条判定被改，都得先让这些用例继续通过。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  STAGE_ROLE,
  healthOf,
  heartbeatPatch,
  rebuildIndex,
  sessionFile,
  stampOf,
  describeHealth,
  nextAction,
  MAX_NUDGES,
  NUDGE_COOLDOWN_MS,
  WORKING_MS,
  IDLE_MS,
  STUCK_MS,
} from '../activity.js';

const MIN = 60 * 1000;
const NOW = 1_700_000_000_000;

function project(overrides = {}) {
  return {
    id: 'p1',
    name: '测试项目',
    status: 'zhongshu',
    updatedAt: NOW - 5 * MIN,
    lastNudgeAt: 0,
    activity: { lastAt: null, lastSize: null, nudges: 0, escalatedAt: null },
    departments: {
      zhongshu: { sessionId: 'sess-zhongshu', state: 'idle' },
      menxia: { sessionId: null },
      shangshu: { sessionId: null },
      executor: { sessionId: null },
    },
    ...overrides,
  };
}

function stamp(minutesAgo) {
  return { at: NOW - minutesAgo * MIN, bytes: 1024, file: 'x' };
}

test('STAGE_ROLE：执行/复核挂在 executor 与 menxia 上', () => {
  assert.equal(STAGE_ROLE.executing, 'executor');
  assert.equal(STAGE_ROLE.review, 'menxia');
  assert.equal(STAGE_ROLE.draft, undefined);
});

test('15 分钟内有写入 = working', () => {
  const h = healthOf(project(), { now: NOW, stamp: stamp(3) });
  assert.equal(h.state, 'working');
  assert.equal(h.level, 'ok');
  assert.equal(h.minutes, 3);
});

test('working 的边界正好在 WORKING_MS', () => {
  const h = healthOf(project(), { now: NOW, stamp: stamp(WORKING_MS / MIN) });
  assert.equal(h.state, 'working');
  const h2 = healthOf(project(), { now: NOW, stamp: stamp(WORKING_MS / MIN + 1) });
  assert.equal(h2.state, 'quiet');
});

test('15–90 分钟 = quiet（黄，但不催）', () => {
  const h = healthOf(project(), { now: NOW, stamp: stamp(40) });
  assert.equal(h.state, 'quiet');
  assert.equal(h.level, 'warn');
});

test('超过 90 分钟 = stale（这才是「空转」）', () => {
  const h = healthOf(project(), { now: NOW, stamp: stamp(IDLE_MS / MIN + 5) });
  assert.equal(h.state, 'stale');
  assert.equal(h.level, 'bad');
  assert.match(h.label, /空转/);
});

test('进程在跑但 30 分钟没产出 = stuck，比空转更可疑', () => {
  const h = healthOf(project(), { now: NOW, stamp: stamp(STUCK_MS / MIN + 2), running: true });
  assert.equal(h.state, 'stuck');
  assert.equal(h.level, 'bad');
  assert.match(h.label, /没有产出/);
});

test('进程在跑、但确实在写 = working（不许冤枉）', () => {
  const h = healthOf(project(), { now: NOW, stamp: stamp(2), running: true });
  assert.equal(h.state, 'working');
});

test('环节没有会话 = unassigned（不是 blocked）', () => {
  const p = project({ departments: { zhongshu: { sessionId: null } } });
  const h = healthOf(p, { now: NOW, stamp: null });
  assert.equal(h.state, 'unassigned');
  assert.equal(h.level, 'bad');
});

test('会话文件找不到/损坏 = dead', () => {
  const h = healthOf(project(), { now: NOW, stamp: null });
  assert.equal(h.state, 'dead');
  assert.equal(h.level, 'bad');
});

test('终态与暂停不算空转，也不会被催', () => {
  for (const status of ['done', 'archived', 'paused', 'blocked', 'draft']) {
    const h = healthOf(project({ status }), { now: NOW, stamp: stamp(999) });
    assert.equal(h.level, 'ok', `${status} 不该被标红`);
  }
});

test('heartbeatPatch：同一帧不重复写盘', () => {
  const p = project({ activity: { lastAt: NOW - 1000, lastSize: 512, nudges: 0, escalatedAt: null } });
  assert.equal(heartbeatPatch(p, { at: NOW - 1000, bytes: 512 }, NOW), null);
  const patch = heartbeatPatch(p, { at: NOW - 500, bytes: 900 }, NOW);
  assert.deepEqual(patch, { lastAt: NOW - 500, lastSize: 900, at: NOW });
});

test('describeHealth：会话有动静但文书没写，要说清楚', () => {
  const p = project({ updatedAt: NOW - 200 * MIN });
  const h = healthOf(p, { now: NOW, stamp: stamp(2) });
  const text = describeHealth(h, p);
  assert.match(text, /分钟前有动作/);
  assert.match(text, /没写任何文书/);
});

test('nextAction：健康时不打扰', () => {
  const p = project();
  const h = healthOf(p, { now: NOW, stamp: stamp(2) });
  assert.equal(nextAction(p, h, NOW).action, 'none');
});

test('nextAction：确认空转就催一次', () => {
  const p = project();
  const h = healthOf(p, { now: NOW, stamp: stamp(120) });
  assert.equal(nextAction(p, h, NOW).action, 'nudge');
});

test('nextAction：30 分钟冷却内不重复催', () => {
  const p = project({ lastNudgeAt: NOW - 5 * MIN });
  const h = healthOf(p, { now: NOW, stamp: stamp(120) });
  const decision = nextAction(p, h, NOW);
  assert.equal(decision.action, 'none');
  assert.equal(decision.reason, 'cooldown');
});

test('nextAction：催满 2 次还不动 → 交给客户三选一', () => {
  const p = project({ lastNudgeAt: NOW - NUDGE_COOLDOWN_MS - MIN });
  p.activity.nudges = MAX_NUDGES;
  const h = healthOf(p, { now: NOW, stamp: stamp(200) });
  assert.equal(nextAction(p, h, NOW).action, 'escalate');
});

test('nextAction：已经上报过就不再重复刷人', () => {
  const p = project();
  p.activity.nudges = MAX_NUDGES;
  p.activity.escalatedAt = NOW - 60000;
  const h = healthOf(p, { now: NOW, stamp: stamp(200) });
  assert.equal(nextAction(p, h, NOW).action, 'none');
});

test('nextAction：会话没了直接上报换人，不浪费一次催办', () => {
  const p = project();
  const h = healthOf(p, { now: NOW, stamp: null });
  assert.equal(nextAction(p, h, NOW).action, 'report');
});

test('rebuildIndex：能从真实目录结构里认出 sessionId', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'court-activity-'));
  try {
    const dir = path.join(root, '--D-Tools-AI--', 'session-aaaa1111-2222-3333-4444-555566667777');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), 'x');

    const broken = path.join(root, '--D-Tools-AI--', 'session-bbbb1111-2222-3333-4444-555566667777');
    mkdirSync(broken, { recursive: true }); // 目录在、文件没了

    rebuildIndex(root);
    assert.equal(
      sessionFile('aaaa1111-2222-3333-4444-555566667777'),
      path.join(dir, 'session.v4.jsonl.zstd'),
    );
    assert.equal(stampOf('aaaa1111-2222-3333-4444-555566667777').bytes, 1);
    assert.equal(sessionFile('bbbb1111-2222-3333-4444-555566667777'), null);
    assert.equal(sessionFile('不存在的会话'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
