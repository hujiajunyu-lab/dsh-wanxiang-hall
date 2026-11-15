import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KB_MAX_ENTRIES,
  digestCandidates,
  kbKind,
  kbStats,
  normalizeEntry,
  normalizeKb,
  pickForContext,
  searchEntries,
  tokenize,
} from '../kb.js';
import { emptyState, normalize } from '../store.js';

const entry = (over = {}) => normalizeEntry({
  id: over.id || 'kb_1',
  kind: over.kind || 'pitfall',
  title: over.title || 'GBK 会让中文报错变成乱码',
  body: over.body || 'cmd.exe 的 stderr 是 GBK 字节，按 utf8 解会变乱码，正则匹配不上。',
  tags: over.tags || ['GBK', 'Windows'],
  ...over,
});

test('normalizeEntry：认不出的类型回落 pattern，标题与正文按上限截断', () => {
  const one = normalizeEntry({ kind: '不存在的类型', title: 'x'.repeat(200), body: 'y'.repeat(9000) });
  assert.equal(one.kind, 'pattern');
  assert.equal(one.title.length, 120);
  assert.equal(one.body.length, 8000);
  assert.equal(one.confidence, 2);
  assert.equal(one.pinned, false);
  assert.ok(one.id);
});

test('normalizeEntry：标签去重、转小写、限长', () => {
  const one = normalizeEntry({ title: 't', body: 'b', tags: ['GBK', 'gbk', '  空格  ', 'z'.repeat(40)] });
  assert.deepEqual(one.tags, ['gbk', '空格', 'z'.repeat(24)]);
});

test('kbKind：认识中文别名，未知回落 pattern', () => {
  assert.equal(kbKind('坑'), 'pitfall');
  assert.equal(kbKind('约定'), 'constraint');
  assert.equal(kbKind('随便'), 'pattern');
});

test('tokenize：中文切二元组、英文按词，短碎片丢掉', () => {
  const tokens = tokenize('小程序 支付 GBK 编码');
  assert.ok(tokens.includes('小程'));
  assert.ok(tokens.includes('程序'));
  assert.ok(tokens.includes('gbk'));
  assert.ok(!tokens.includes('小'));
});

test('searchEntries：标题命中排在正文命中前面，空查询返回全部', () => {
  const titleHit = entry({ id: 'kb_a', title: '支付回调要幂等', body: '无关内容' });
  const bodyHit = entry({ id: 'kb_b', title: '退款流程', body: '支付回调重复触发会重复退款' });
  const hits = searchEntries([bodyHit, titleHit], '支付');
  assert.equal(hits[0].id, 'kb_a');
  assert.equal(searchEntries([titleHit, bodyHit], '').length, 2);
});

test('searchEntries：按类型与标签过滤', () => {
  const pitfall = entry({ id: 'kb_p', kind: 'pitfall', tags: ['win'] });
  const decision = entry({ id: 'kb_d', kind: 'decision', title: '支付走 mock', tags: ['win'] });
  assert.deepEqual(searchEntries([pitfall, decision], '', { kind: 'decision' }).map((x) => x.id), ['kb_d']);
  assert.deepEqual(searchEntries([pitfall, decision], '', { tag: 'win' }).map((x) => x.id), ['kb_p', 'kb_d']);
  assert.deepEqual(searchEntries([pitfall, decision], '', { tag: 'nope' }), []);
});

test('pickForContext：置顶优先，其次按项目标签相关度排', () => {
  const pinned = entry({ id: 'kb_pin', title: '铁律：不要动 .git', pinned: true });
  const related = entry({ id: 'kb_rel', title: '小程序分包配置', tags: ['小程序'] });
  const unrelated = entry({ id: 'kb_un', title: 'Java 若依分层', tags: ['java'] });
  const picked = pickForContext([unrelated, related, pinned], { name: '师大咖啡小程序', context: { stack: '小程序' } }, 2);
  assert.deepEqual(picked.map((x) => x.id), ['kb_pin', 'kb_rel']);
});

test('digestCandidates：从技术栈/约定/坑/交付文书里拆候选并去重', () => {
  const project = {
    id: 'p_1',
    name: '师大咖啡',
    status: 'done',
    context: {
      stack: '微信小程序原生 + mock 后端',
      conventions: '金额一律用分\n不要在前端算手续费',
      gotchas: 'GBK 输出会让命令判定失效',
    },
    briefs: [
      { id: 'b1', kind: 'report', title: '交付说明', content: '1. 三处模拟已标注清楚，不接真实支付\n- 抽奖保持演示形态' },
    ],
  };
  const list = digestCandidates(project, []);
  assert.ok(list.length >= 5);
  assert.ok(list.some((x) => x.kind === 'tool' && x.title.includes('技术栈')));
  assert.ok(list.some((x) => x.kind === 'constraint' && x.title.includes('金额一律用分')));
  assert.ok(list.some((x) => x.kind === 'pitfall' && x.title.includes('GBK')));
  assert.ok(list.some((x) => x.kind === 'decision' && x.title.includes('三处模拟')));
  assert.equal(list.length, new Set(list.map((x) => x.title)).size);
});

test('kbStats：总数、置顶数、按类型计数', () => {
  const stats = kbStats([entry({ id: 'a', kind: 'pitfall', pinned: true }), entry({ id: 'b', kind: 'decision' })]);
  assert.equal(stats.total, 2);
  assert.equal(stats.pinned, 1);
  assert.equal(stats.byKind.pitfall, 1);
  assert.equal(stats.byKind.decision, 1);
});

test('store：空状态带 kb，normalize 保留条目并截断到上限', () => {
  assert.deepEqual(emptyState().kb, { entries: [] });
  const many = Array.from({ length: KB_MAX_ENTRIES + 20 }, (_, index) => entry({ id: `kb_${index}`, title: `条目 ${index}` }));
  const state = normalize({ version: 4, projects: {}, kb: { entries: many } });
  assert.equal(state.kb.entries.length, KB_MAX_ENTRIES);
  assert.equal(normalizeKb({ entries: 'garbage' }).entries.length, 0);
});
