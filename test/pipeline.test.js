import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PIPELINES,
  SHAPES,
  SHAPE_META,
  assertTransition,
  canSaveBrief,
  canTransition,
  canUpdateStatus,
  hasSeat,
  seatsOf,
  shapeOf,
  stagesOf,
  normalizeBriefKind,
} from '../auth.js';
import { emptyState, normalizeProject } from '../store.js';
import { BUDGET, budgetOf } from '../context.js';

test('文书类型：六张纸都认得，中文别名可用，认不出必须报错', () => {
  assert.equal(normalizeBriefKind('contract'), 'contract');
  assert.equal(normalizeBriefKind('验收'), 'acceptance');
  assert.equal(normalizeBriefKind('需求确认书'), 'contract');
  assert.equal(normalizeBriefKind(undefined), 'brief');
  // 静默降级会让「契约 3000 字」的预算失效——回归实测踩过。
  assert.throws(() => normalizeBriefKind('随便什么类型'), /未知的文书类型/);

  assert.equal(canSaveBrief('zhongshu', 'contract'), true);
  assert.equal(canSaveBrief('executor', 'contract'), false);
  assert.equal(canSaveBrief('shangshu', 'package'), true);
  assert.equal(canSaveBrief('secretary', 'closing'), true);
  assert.equal(canSaveBrief('menxia', 'acceptance'), true);

  // 每张纸都有自己的上限，且都对外可见
  for (const kind of ['contract', 'quote', 'package', 'change', 'architecture', 'acceptance', 'closing']) {
    assert.ok(BUDGET[kind] > 0, `${kind} 缺预算`);
    assert.equal(budgetOf(kind), BUDGET[kind]);
  }
});

test('三种编制都在表里，且各自的席位与驳回上限自洽', () => {
  assert.deepEqual(SHAPES, ['squad', 'crew', 'line']);
  for (const shape of SHAPES) {
    const meta = SHAPE_META[shape];
    assert.ok(meta.label, `${shape} 缺中文名`);
    assert.ok(meta.roles.includes('zhongshu'), `${shape} 必须有架构`);
    assert.ok(meta.roles.includes('shangshu'), `${shape} 必须有交付`);
    assert.equal(PIPELINES[shape], stagesOf(shape));
    assert.ok(meta.rejectCap >= 1 && meta.rejectCap <= 2, `${shape} 驳回上限应 1–2`);
  }
  assert.deepEqual(seatsOf('squad'), ['zhongshu', 'shangshu']);
  assert.ok(!hasSeat('squad', 'menxia'), '轻量编制不该有门下席位');
  assert.ok(!hasSeat('squad', 'executor'), '轻量编制不该有执行者席位');
  assert.ok(hasSeat('squad', 'secretary'), '秘书恒有席位');
  assert.ok(hasSeat('squad', 'user'), '人手旁路恒有席位');
  assert.deepEqual(seatsOf('crew'), ['zhongshu', 'menxia', 'shangshu', 'executor']);
  assert.ok(hasSeat('line', 'executor'));
  assert.ok(!hasSeat('line', 'menxia'));
});

test('shapeOf 对未知/缺失一律回落 crew', () => {
  assert.equal(shapeOf({ shape: 'squad' }), 'squad');
  assert.equal(shapeOf({ shape: 'line' }), 'line');
  assert.equal(shapeOf({ shape: 'nope' }), 'crew');
  assert.equal(shapeOf({}), 'crew');
  assert.equal(shapeOf(null), 'crew');
  assert.equal(shapeOf({ mode: 'lite' }), 'crew', 'shapeOf 只看 shape，旧字段由 store 归一化');
});

test('轻量编制：架构 → 交付 → 自己干 → 秘书抽验', () => {
  assert.ok(canTransition('draft', 'secretary', 'zhongshu', 'squad'));
  assert.ok(canTransition('draft', 'zhongshu', 'zhongshu', 'squad'));
  assert.ok(canTransition('zhongshu', 'zhongshu', 'shangshu', 'squad'));
  assert.ok(canTransition('shangshu', 'shangshu', 'executing', 'squad'));
  assert.ok(canTransition('shangshu', 'shangshu', 'zhongshu', 'squad'), '交付能退回架构改契约');
  assert.ok(canTransition('executing', 'shangshu', 'review', 'squad'), '尚书自己交审');
  assert.ok(canTransition('review', 'secretary', 'done', 'squad'));
  assert.ok(canTransition('review', 'secretary', 'executing', 'squad'), '秘书能打回返工');

  assert.ok(!canTransition('zhongshu', 'zhongshu', 'menxia', 'squad'), '轻量编制没有门下这一站');
  assert.ok(!canTransition('review', 'menxia', 'done', 'squad'), '没有门下，他就不能签');
  assert.ok(!canTransition('executing', 'executor', 'review', 'squad'), '没有执行者席位');
});

test('完整编制：原有四省链路一字不改', () => {
  assert.ok(canTransition('zhongshu', 'zhongshu', 'menxia', 'crew'));
  assert.ok(canTransition('menxia', 'menxia', 'shangshu', 'crew'));
  assert.ok(canTransition('menxia', 'menxia', 'zhongshu', 'crew'), '驳回退回架构');
  assert.ok(canTransition('shangshu', 'shangshu', 'executing', 'crew'));
  assert.ok(canTransition('executing', 'executor', 'review', 'crew'));
  assert.ok(canTransition('review', 'menxia', 'done', 'crew'));
  assert.ok(canTransition('review', 'menxia', 'executing', 'crew'));
  assert.ok(!canTransition('zhongshu', 'zhongshu', 'shangshu', 'crew'), '完整编制不能跳门下');
  assert.ok(!canTransition('review', 'executor', 'done', 'crew'), '执行者不能自签');
});

test('批量编制：执行者干活、尚书汇总、秘书可越级', () => {
  assert.ok(canTransition('zhongshu', 'zhongshu', 'shangshu', 'line'));
  assert.ok(canTransition('executing', 'executor', 'review', 'line'));
  assert.ok(canTransition('review', 'shangshu', 'done', 'line'));
  assert.ok(canTransition('review', 'secretary', 'done', 'line'));
  assert.ok(!canTransition('zhongshu', 'zhongshu', 'menxia', 'line'));
});

test('人手旁路 user 在任意编制里都放行，未知编制按完整处理', () => {
  for (const shape of [...SHAPES, 'weird']) {
    assert.ok(canTransition('review', 'user', 'archived', shape));
    assert.ok(hasSeat(shape, 'user'));
  }
  assert.ok(canTransition('zhongshu', 'zhongshu', 'menxia', 'weird'));
});

test('assertTransition 的报错里带编制名，便于面板直接显示', () => {
  assert.throws(
    () => assertTransition('zhongshu', 'zhongshu', 'menxia', 'squad'),
    /轻量组/,
  );
  assert.throws(
    () => assertTransition('zhongshu', 'zhongshu', 'shangshu', 'crew'),
    /项目组/,
  );
  assert.doesNotThrow(() => assertTransition('zhongshu', 'zhongshu', 'menxia', 'crew'));
});

test('canUpdateStatus 跟着编制走', () => {
  assert.ok(canUpdateStatus('executing', 'shangshu', 'review', 'squad'));
  assert.ok(!canUpdateStatus('executing', 'executor', 'review', 'squad'));
  assert.ok(canUpdateStatus('executing', 'executor', 'review', 'crew'));
  assert.ok(canUpdateStatus('review', 'secretary', 'executing', 'squad'));
  assert.ok(!canUpdateStatus('review', 'menxia', 'executing', 'squad'));
  assert.ok(canUpdateStatus('review', 'shangshu', 'done', 'line'));
  assert.ok(!canUpdateStatus('review', 'shangshu', 'done', 'crew'));
  assert.ok(canUpdateStatus('review', 'secretary', 'done', 'crew'));
  assert.ok(canUpdateStatus('draft', 'shangshu', 'blocked', 'squad'));
});

test('交付说明（report）在轻量编制里允许尚书自己写', () => {
  assert.ok(canSaveBrief('executor', 'report'));
  assert.ok(canSaveBrief('shangshu', 'report'), '尚书兼工程师时得能写交付说明');
  assert.ok(!canSaveBrief('zhongshu', 'report'));
  assert.ok(!canSaveBrief('shangshu', 'verdict'));
});

test('schema v4：emptyState 版本是 4，旧 mode 项目自动补 shape', () => {
  assert.equal(emptyState().version, 4);

  const legacyLite = normalizeProject('p1', {
    name: '老轻量',
    status: 'executing',
    mode: 'lite',
    createdAt: 1,
    updatedAt: 2,
  });
  assert.equal(legacyLite.shape, 'squad');
  assert.equal(legacyLite.mode, 'lite');

  const legacyFull = normalizeProject('p2', {
    name: '老完整',
    status: 'menxia',
    mode: 'full',
  });
  assert.equal(legacyFull.shape, 'crew');
  assert.equal(legacyFull.mode, 'full');

  const explicit = normalizeProject('p3', { name: '显式', shape: 'line', mode: 'lite' });
  assert.equal(explicit.shape, 'line');
  assert.equal(explicit.mode, 'lite', 'mode 是遗留字段，跟着 shape 走');

  const garbage = normalizeProject('p4', { name: '垃圾', shape: 'nonsense' });
  assert.equal(garbage.shape, 'crew');
  assert.equal(garbage.mode, 'full');
});

test('schema v4：新字段都有安全零值，老状态文件也能读', () => {
  const project = normalizeProject('p5', { name: '空项目' });
  assert.equal(project.lineage, null, '没有父项目时血缘为空');
  assert.deepEqual(project.linkedSessions, []);
  assert.equal(project.context.map, '');
  assert.equal(project.context.stack, '');
  assert.deepEqual(project.context.topPaths, []);
  assert.deepEqual(project.packages, []);
  assert.deepEqual(project.ownership, []);
  assert.deepEqual(project.manual, []);
  assert.deepEqual(project.rejects, []);
  assert.deepEqual(project.answers, []);
  assert.deepEqual(project.items, []);
  assert.equal(project.budget.maxTokens, 0);
  assert.equal(project.budget.spentTokens, 0);
  assert.equal(project.actual.tokens, 0);
  assert.equal(project.quote, null, '没报价就是 null，面板显示「未报价」');
  assert.equal(project.delegation, null, '没有委托就没有代签记录');
  assert.equal(project.legacy, null);
});

test('schema v4：packages/manual/rejects 的上限与取值被夹紧', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    id: `k${index}`,
    title: `包 ${index}`,
    state: index % 2 ? 'doing' : 'bogus',
    files: Array.from({ length: 80 }, (_v, i) => `f${i}.js`),
  }));
  const project = normalizeProject('p6', {
    name: '夹紧',
    packages: many,
    manual: Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, title: `事 ${i}`, state: 'weird' })),
    rejects: Array.from({ length: 20 }, (_, i) => ({
      round: i,
      decision: 'reject',
      mustFix: [{ issue: 'a', evidence: 'b' }, { issue: 'c' }, { issue: 'd' }, { issue: 'e' }],
    })),
  });
  assert.equal(project.packages.length, 30);
  assert.equal(project.packages[0].files.length, 60);
  assert.equal(project.packages[0].state, 'queued', '非法状态回落 queued');
  assert.equal(project.packages[1].state, 'doing');
  assert.equal(project.manual.length, 40);
  assert.equal(project.manual[0].status, 'pending');
  assert.equal(project.rejects.length, 10);
  assert.equal(project.rejects[0].mustFix.length, 3, 'mustFix 最多 3 条');
});

test('normalize 幂等：跑两遍形状不变', () => {
  const once = normalizeProject('p7', {
    name: '幂等',
    shape: 'squad',
    context: { map: 'a', topPaths: ['x', 'y'] },
    packages: [{ title: 't', files: ['a.js'] }],
  });
  const twice = normalizeProject('p7', once);
  assert.deepEqual(twice.shape, once.shape);
  assert.deepEqual(twice.context, once.context);
  assert.deepEqual(twice.packages, once.packages);
  assert.deepEqual(twice.ownership, once.ownership);
});
