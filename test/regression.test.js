/**
 * Step 4 回归：用真目录、真命令把新机制跑一遍（不依赖 DSH 运行时）。
 *
 * 覆盖：
 *  1. 三编制状态机（谁能推到哪、谁没有席位、驳回上限）
 *  2. 验收命令预跑（真命令可跑、假命令当场判 env）
 *  3. 验收命令执行 + 基线快照 + 越界审计（真文件改动）
 *  4. 工单拆分与依赖顺序
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在 import store/snapshot/checks 之前设置，避免踩到真实 ~/.dsh/court
const STATE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'court-regress-state-'));
process.env.COURT_STATE_DIR = STATE_DIR;

const { canTransition, canUpdateStatus, hasSeat, shapeOf } = await import('../auth.js');
const { normalizeChecks, preflightCheck, runChecks } = await import('../checks.js');
const { diffSnapshot, loadBaseline, saveBaseline, takeSnapshot } = await import('../snapshot.js');
const { auditChanges } = await import('../ownership.js');
const { nextPackage, validatePackages } = await import('../packages.js');
const { handoffText } = await import('../handoff.js');

const project = (over = {}) => ({
  id: 'p-regress',
  name: '回归项目',
  shape: 'crew',
  rounds: 0,
  ownership: [],
  packages: [],
  ...over,
});

test('三编制：轻量没有门下席位，完整可以用门下，批量由尚书汇总', () => {
  assert.equal(hasSeat('squad', 'menxia'), false);
  assert.equal(hasSeat('squad', 'executor'), false);
  assert.equal(hasSeat('crew', 'menxia'), true);
  assert.equal(hasSeat('line', 'menxia'), false);

  // 轻量：中书直接把方案交给尚书（不经过门下）
  assert.equal(canTransition('zhongshu', 'zhongshu', 'shangshu', 'squad'), true);
  assert.equal(canTransition('zhongshu', 'zhongshu', 'menxia', 'squad'), false);
  // 完整：中书只能先给门下
  assert.equal(canTransition('zhongshu', 'zhongshu', 'menxia', 'crew'), true);
  assert.equal(canTransition('zhongshu', 'zhongshu', 'shangshu', 'crew'), false);
  // 谁也不许跳过执行直接验收
  assert.equal(canTransition('shangshu', 'shangshu', 'done', 'crew'), false);
});

test('三编制：验收结论的签署人不同', () => {
  assert.equal(canUpdateStatus('review', 'secretary', 'done', 'squad'), true);
  assert.equal(canUpdateStatus('review', 'shangshu', 'done', 'squad'), false);
  assert.equal(canUpdateStatus('review', 'menxia', 'done', 'crew'), true);
  assert.equal(canUpdateStatus('review', 'shangshu', 'done', 'line'), true);
});

test('shapeOf：老项目没有 shape 时按 crew 处理，宁可多一道评审', () => {
  assert.equal(shapeOf({}), 'crew');
  assert.equal(shapeOf({ shape: 'nonsense' }), 'crew');
  assert.equal(shapeOf({ shape: 'squad' }), 'squad');
});

test('预跑：真实命令判 ok，不存在的命令当场判 env', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'court-regress-ws-'));
  const good = normalizeChecks([{ id: 'node', command: 'node --version', shell: 'cmd' }], { strict: true })[0];
  const goodResult = await preflightCheck(good, dir);
  assert.equal(goodResult.ok, true, JSON.stringify(goodResult));

  const bad = normalizeChecks([{ id: 'ghost', command: 'definitely-not-a-real-command-xyz', shell: 'cmd' }], { strict: true })[0];
  const badResult = await preflightCheck(bad, dir);
  assert.equal(badResult.ok, false);
  assert.equal(badResult.kind, 'env');
});

test('验收 + 基线 + 越界：真改文件，审计要抓得住', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'court-regress-audit-'));
  await fs.writeFile(path.join(dir, 'ok.txt'), 'v1', 'utf8');
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src', 'app.js'), 'console.log(1)', 'utf8');

  const baseline = await takeSnapshot(dir);
  await saveBaseline('p-regress', baseline);
  assert.ok(await loadBaseline('p-regress'));

  // 改一个「归属内」的、加一个「越界」的
  await fs.writeFile(path.join(dir, 'src', 'app.js'), 'console.log(2)', 'utf8');
  await fs.writeFile(path.join(dir, 'secret.env'), 'KEY=1', 'utf8');

  const diff = await diffSnapshot(dir, baseline);
  const changed = [...diff.added, ...diff.modified, ...diff.removed];
  assert.ok(changed.includes('secret.env'));
  assert.ok(changed.includes('src/app.js'));

  const strict = auditChanges(project({ ownership: ['src/**'] }), changed);
  assert.equal(strict.verdict, 'out-of-scope');
  assert.deepEqual(strict.outOfScope, ['secret.env']);

  const loose = auditChanges(project({ ownership: ['src/**', 'secret.env'] }), changed);
  assert.equal(loose.verdict, 'ok');
});

test('验收命令执行：通过时 ok=true，失败时 ok=false 且带提示', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'court-regress-run-'));
  await fs.writeFile(path.join(dir, 'ok.js'), 'process.exit(0)', 'utf8');
  await fs.writeFile(path.join(dir, 'bad.js'), 'process.exit(3)', 'utf8');

  const pass = await runChecks(
    project({ workspace: { id: 'ws', path: dir }, checks: normalizeChecks([{ id: 'pass', command: 'node ok.js', shell: 'cmd' }]) }),
    { by: 'regress' },
  );
  assert.equal(pass.ok, true);

  const fail = await runChecks(
    project({ workspace: { id: 'ws', path: dir }, checks: normalizeChecks([{ id: 'fail', command: 'node bad.js', shell: 'cmd' }]) }),
    { by: 'regress' },
  );
  assert.equal(fail.checks[0].exitCode, 3);
});

test('工单：顺序与冲突在拆分阶段就被挡住', () => {
  const packages = [
    { id: 'k1', title: 'A', files: ['src/a.js'], dod: ['x'], state: 'queued', dependsOn: [] },
    { id: 'k2', title: 'B', files: ['src/b.js'], dod: ['x'], state: 'queued', dependsOn: ['k1'] },
  ];
  assert.deepEqual(validatePackages(packages).errors, []);
  assert.equal(nextPackage(packages).id, 'k1');
  packages[0].state = 'merged';
  assert.equal(nextPackage(packages).id, 'k2');

  const clash = validatePackages([
    { id: 'k1', title: 'A', files: ['src/**'], dod: ['x'], state: 'queued', dependsOn: [] },
    { id: 'k2', title: 'B', files: ['src/a.js'], dod: ['x'], state: 'queued', dependsOn: [] },
  ]);
  assert.ok(clash.errors.some((item) => /加 dependsOn/.test(item)));
});

test('移交提示：长方案只给指针 + 索引 + 当前工单，不重发全文', async () => {
  const longPlan = '方案正文。'.repeat(3000); // 15000 字，远超内联上限
  const brief = {
    id: 'b1',
    kind: 'plan',
    title: '改造方案',
    author: 'zhongshu',
    content: longPlan,
    chars: longPlan.length,
    createdAt: Date.now(),
    version: 1,
  };
  const proj = project({
    status: 'zhongshu',
    briefs: [brief],
    packages: [{ id: 'k1', title: '接线', goal: '把接口接上', files: ['src/app.js'], dod: ['跑通'], state: 'queued', dependsOn: [] }],
    context: { map: '入口 src/app.js', stack: 'node 22', conventions: '不加依赖', gotchas: '', topPaths: [] },
  });

  const text = handoffText(proj, brief, 'zhongshu', 'executor', '按工单做', brief);
  assert.ok(text.includes('项目索引'), '应当带项目索引');
  assert.ok(text.includes('court_read_brief'), '长方案应当改成指针');
  assert.ok(!text.includes(longPlan.slice(0, 400)), '不许把 15K 正文塞进提示词');
  assert.ok(text.includes('你这一张工单'), '派给执行者时要带工单');
  assert.ok(text.includes('src/app.js'));
});
