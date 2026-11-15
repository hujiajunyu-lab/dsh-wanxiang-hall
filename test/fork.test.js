import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFork, summarize } from '../fork.js';
import { buildIndex } from '../context.js';
import { normalizeProject, emptyState } from '../store.js';

function parentProject(overrides = {}) {
  return normalizeProject('p_parent', {
    name: '师大咖啡体检',
    shape: 'crew',
    status: 'done',
    workspace: { id: 'w1', path: 'D:\\project\\coffee' },
    context: {
      map: 'miniprogram/{pages,mock,store}',
      stack: '原生小程序 + mock 后端',
      conventions: '页面四文件齐备',
      gotchas: '余额是 onLoad 快照',
      topPaths: ['mock/api.js'],
    },
    ownership: [{ path: 'mock/**', owner: 'shangshu' }],
    checks: [{ id: 'c1', name: 'test', command: 'node test.js', shell: 'cmd' }],
    departments: {
      zhongshu: { sessionId: 'session-z', state: 'idle' },
      menxia: { sessionId: 'session-m', state: 'idle' },
      shangshu: { sessionId: 'session-s', state: 'idle' },
    },
    ...overrides,
  });
}

test('承接：工作区/上下文/归属/验收全部继承，并记下血缘', () => {
  const parent = parentProject();
  const { project, reusedSessions } = buildFork(parent, { id: 'p_child', name: '第二轮：改结算页' });

  assert.equal(project.shape, 'crew');
  assert.equal(project.workspace.path, 'D:\\project\\coffee');
  assert.equal(project.context.stack, '原生小程序 + mock 后端');
  assert.equal(project.ownership.length, 1);
  assert.equal(project.checks.length, 1, '验收命令是仓库知识，默认继承');
  assert.equal(project.packages.length, 0, '工单是上一轮的任务，不能继承');
  assert.equal(project.status, 'draft');
  assert.equal(project.lineage.parentId, 'p_parent');
  assert.equal(project.lineage.name, '师大咖啡体检');
  assert.equal(project.lineage.kind, 'clone');
  assert.equal(reusedSessions, 3);
});

test('承接：编制缩小时只复用仍然存在的席位', () => {
  const parent = parentProject();
  const { project, reusedSessions } = buildFork(parent, { id: 'p_child', name: '轻量续作', shape: 'squad' });

  assert.equal(project.shape, 'squad');
  assert.equal(reusedSessions, 2, 'squad 只有 zhongshu 和 shangshu');
  assert.equal(project.departments.zhongshu.sessionId, 'session-z');
  assert.equal(project.departments.shangshu.sessionId, 'session-s');
  assert.equal(project.departments.menxia.sessionId, null);
  const roles = project.linkedSessions.map((item) => item.role).sort();
  assert.deepEqual(roles, ['shangshu', 'zhongshu']);
  assert.ok(project.linkedSessions.every((item) => item.projectId === 'p_parent' && item.inherited));
});

test('承接：reuseSessions=false 时不复用任何会话，但知识照旧继承', () => {
  const parent = parentProject();
  const { project, reusedSessions } = buildFork(parent, {
    id: 'p_child',
    name: '换一拨人做',
    reuseSessions: false,
  });

  assert.equal(reusedSessions, 0);
  assert.deepEqual(project.linkedSessions, []);
  assert.equal(project.departments.zhongshu.sessionId, null);
  assert.equal(project.context.map, 'miniprogram/{pages,mock,store}');
});

test('承接：inheritChecks=false 只丢掉验收命令，别的都留着', () => {
  const parent = parentProject();
  const { project } = buildFork(parent, { id: 'p_child', name: '换套验收', inheritChecks: false });

  assert.equal(project.checks.length, 0);
  assert.equal(project.ownership.length, 1);
  assert.equal(project.workspace.path, 'D:\\project\\coffee');
});

test('承接：项目名不能为空；父项目必须存在', () => {
  assert.throws(() => buildFork(parentProject(), { id: 'p_child', name: '   ' }), /项目名不能为空/);
  assert.throws(() => buildFork(null, { name: 'x' }), /被承接的项目不存在/);
});

test('承接：normalizeProject 保住 lineage.name（否则面板上只剩一串 id）', () => {
  const parent = parentProject();
  const { project } = buildFork(parent, { id: 'p_child', name: 'x' });
  const again = normalizeProject('p_child', project);
  assert.equal(again.lineage.name, '师大咖啡体检');
  assert.equal(again.lineage.parentId, 'p_parent');
});

test('承接：summarize 说清楚省下了什么', () => {
  const parent = parentProject();
  const { project } = buildFork(parent, { id: 'p_child', name: 'x' });
  const text = summarize(parent, project);
  assert.match(text, /工作区/);
  assert.match(text, /验收命令/);
  assert.match(text, /个会话/);
});

test('承接：空父项目不会造出假继承', () => {
  const bare = normalizeProject('p_bare', { name: '空项目', shape: 'squad' });
  const { project, inherited } = buildFork(bare, { id: 'p_child', name: 'x' });
  assert.equal(project.workspace, null);
  assert.deepEqual(project.checks, []);
  assert.equal(inherited, '只有项目记录');
});

test('承接：emptyState 仍是 schema v4', () => {
  assert.equal(emptyState().version, 4);
});

test('索引里写清「承接自谁」，让中书别重新摸底', () => {
  const parent = parentProject();
  const { project } = buildFork(parent, { id: 'p_child', name: 'x' });
  const index = buildIndex(project);
  assert.match(index, /承接：师大咖啡体检/);
  assert.match(index, /不要重新摸底/);
});

test('索引里带报价与记账，超轮次会喊停', () => {
  const parent = parentProject();
  const { project } = buildFork(parent, { id: 'p_child', name: 'x' });
  project.quote = { rounds: 1, tokenBudget: 200000, note: '', at: Date.now(), by: 'shangshu' };
  project.actual = { ...project.actual, rounds: 2, verifications: 3 };
  const index = buildIndex(project);
  assert.match(index, /1 轮返工/);
  assert.match(index, /200K token/);
  assert.match(index, /已用 2 轮、3 次验收/);
  assert.match(index, /轮次已超报价/);
});
