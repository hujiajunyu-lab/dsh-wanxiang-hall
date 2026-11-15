import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 智库与项目状态分文件存放：先钉住状态目录再动态 import，避免读到真身。
const DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'court-kbstore-'));
process.env.COURT_STATE_DIR = DIR;

const store = await import('../store.js');
const { read, update, kbStateFilePath, emptyState } = store;

const COURT = path.join(DIR, 'court.json');

test('智库写入落到 kb.json，court.json 里不再有 kb', async () => {
  await update((current) => {
    current.projects.p_1 = store.normalizeProject('p_1', { name: '分文件测试' });
  });
  await update((current) => {
    current.kb.entries.unshift({
      id: 'kb_1',
      kind: 'pitfall',
      title: 'GBK 会让命令判定失效',
      body: 'cmd.exe 的 stderr 是 GBK 字节。',
      tags: ['gbk'],
      hits: 0,
    });
  });

  const kbRaw = JSON.parse(await fs.readFile(kbStateFilePath(), 'utf8'));
  assert.equal(kbRaw.entries.length, 1);
  assert.equal(kbRaw.entries[0].id, 'kb_1');

  const courtRaw = JSON.parse(await fs.readFile(COURT, 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(courtRaw, 'kb'), false);
  assert.ok(courtRaw.projects.p_1);
});

test('内存里的 state 依然带着 kb（路由与索引都从这里取）', async () => {
  const state = await read();
  assert.equal(state.kb.entries.length, 1);
  assert.equal(state.kb.entries[0].title, 'GBK 会让命令判定失效');
});

test('hits 变化会真的写进 kb.json', async () => {
  await update((current) => {
    current.kb.entries[0].hits += 1;
  });
  const kbRaw = JSON.parse(await fs.readFile(kbStateFilePath(), 'utf8'));
  assert.equal(kbRaw.entries[0].hits, 1);
});

test('旧数据迁移：court.json 里带 kb、没有 kb.json 时，下次写盘落成独立文件', async () => {
  const legacyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'court-kblegacy-'));
  const legacyState = emptyState();
  legacyState.projects.p_2 = store.normalizeProject('p_2', { name: '老库里带记忆' });
  legacyState.kb = { entries: [{ id: 'kb_old', kind: 'decision', title: '老结论', body: '老结论正文内容' }] };
  await fs.writeFile(path.join(legacyDir, 'court.json'), JSON.stringify(legacyState), 'utf8');

  const previous = process.env.COURT_STATE_DIR;
  process.env.COURT_STATE_DIR = legacyDir;
  // 换一个模块实例（查询串绕过 ESM 缓存），让它按新目录重新求值 STATE_DIR
  const fresh = await import(`../store.js?legacy=${Date.now()}`);
  process.env.COURT_STATE_DIR = previous;

  assert.equal(fresh.kbStateFilePath(), path.join(legacyDir, 'kb.json'));
  const loaded = await fresh.read();
  assert.equal(loaded.kb.entries.length, 1);
  assert.equal(loaded.kb.entries[0].id, 'kb_old');

  await fresh.update((current) => {
    current.kb.entries[0].confidence = 3;
  });
  const moved = JSON.parse(await fs.readFile(path.join(legacyDir, 'kb.json'), 'utf8'));
  assert.equal(moved.entries[0].id, 'kb_old');
  assert.equal(moved.entries[0].confidence, 3);
  const shrunk = JSON.parse(await fs.readFile(path.join(legacyDir, 'court.json'), 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(shrunk, 'kb'), false);
});
