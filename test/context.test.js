import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUDGET,
  INDEX_MAX_CHARS,
  assertBriefBudget,
  briefPointer,
  budgetOf,
  buildIndex,
  recentBriefs,
} from '../context.js';

function project(overrides = {}) {
  return {
    id: 'p1',
    name: '锦盏藏华',
    status: 'menxia',
    shape: 'crew',
    rounds: 0,
    workspace: { id: 'w1', path: 'D:\\work\\jinzhan' },
    scope: { original: '把首页改快一点，首屏 1 秒内打开', drift: null, approvedPlanId: '' },
    checks: [],
    packages: [],
    manual: [],
    questions: [],
    context: {},
    briefs: [],
    ...overrides,
  };
}

test('buildIndex：一页纸里有项目、编制、工作区、验收', () => {
  const text = buildIndex(project({
    checks: [{ id: 'c1', cmd: 'npm test' }, { id: 'c2', cmd: 'npm run build' }],
  }));
  assert.match(text, /锦盏藏华/);
  assert.match(text, /项目组/);
  assert.match(text, /D:\\work\\jinzhan/);
  assert.match(text, /c1=npm test/);
  assert.match(text, /c2=npm run build/);
  assert.ok(text.length <= INDEX_MAX_CHARS);
});

test('buildIndex：没登记验收时明确提示，而不是留空', () => {
  const text = buildIndex(project());
  assert.match(text, /未登记验收命令/);
});

test('buildIndex：上下文很长时仍然不超预算', () => {
  const text = buildIndex(project({
    context: {
      map: 'a'.repeat(5000),
      conventions: 'b'.repeat(5000),
      gotchas: 'c'.repeat(5000),
      topPaths: Array.from({ length: 40 }, (_, i) => `src/very/long/path/number-${i}.js`),
    },
    scope: { original: 'd'.repeat(3000), drift: null },
  }));
  assert.ok(text.length <= INDEX_MAX_CHARS, `实际 ${text.length}`);
  assert.match(text, /…/);
});

test('buildIndex：轻量编制显示「轻量组」，批量显示「流水线」', () => {
  assert.match(buildIndex(project({ shape: 'squad' })), /轻量组/);
  assert.match(buildIndex(project({ shape: 'line' })), /流水线/);
});

test('buildIndex：范围漂移与待办要显形', () => {
  const text = buildIndex(project({
    scope: { original: 'x', drift: { reason: '偷偷加了支付' }, approvedPlanId: 'b1' },
    manual: [{ id: 'm1', status: 'pending' }, { id: 'm2', status: 'done' }],
    questions: [{ id: 'q1' }],
    rounds: 1,
  }));
  assert.match(text, /范围漂移/);
  assert.match(text, /偷偷加了支付/);
  assert.match(text, /待用户动手：1 项/);
  assert.match(text, /待用户回答：1 项/);
  assert.match(text, /驳回轮次：1／上限 2/);
});

test('buildIndex：空项目不崩', () => {
  const text = buildIndex({});
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0);
});

test('recentBriefs：最新在前，且带字数与 id', () => {
  const lines = recentBriefs(project({
    briefs: [
      { id: 'b1', kind: 'brief', title: '旧', content: 'x' },
      { id: 'b2', kind: 'plan', title: '新', content: 'yy' },
    ],
  }), 2);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /plan:b2/);
  assert.match(lines[0], /2字/);
  assert.match(lines[1], /brief:b1/);
});

test('budgetOf：已知类型给预算，未知类型兜底 6000', () => {
  assert.equal(budgetOf('contract'), BUDGET.contract);
  assert.equal(budgetOf('plan'), BUDGET.plan);
  assert.equal(budgetOf('whatever'), 6000);
});

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

test('assertBriefBudget：卡在边界内放行，超一个字符就抛 BRIEF_TOO_LONG', () => {
  assert.doesNotThrow(() => assertBriefBudget('contract', 'x'.repeat(BUDGET.contract)));
  const error = thrown(() => assertBriefBudget('contract', 'x'.repeat(BUDGET.contract + 1)));
  assert.ok(error, '应当抛错');
  assert.equal(error.code, 'BRIEF_TOO_LONG');
  assert.match(error.message, /court_revise_brief/);
});

test('assertBriefBudget：方案超预算时提示分流，而不是让人整篇重发', () => {
  const error = thrown(() => assertBriefBudget('plan', 'x'.repeat(BUDGET.plan + 1)));
  assert.ok(error, '应当抛错');
  assert.equal(error.code, 'BRIEF_TOO_LONG');
  assert.match(error.message, /结论\/接口\/文件清单/);
});

test('briefPointer：给出 id 与取全文的方法，不给正文', () => {
  const pointer = briefPointer({ id: 'b9', kind: 'plan', title: '方案', content: 'y'.repeat(9000) });
  assert.match(pointer, /id=b9/);
  assert.match(pointer, /court_read_brief/);
  assert.ok(pointer.length < 300);
});
