/**
 * 数据丢失守卫：2026-11-15 01:28 的事故回归测试。
 *
 * 事故链：迁移时 ~/.dsh 的 junction 还没建好 → 插件读状态文件 ENOENT →
 * 静默用空状态顶上 → 备份定时器照常写盘 → 455KB 的 24 份文书被 434 字节的空文件覆盖。
 *
 * 这里只测纯逻辑，不碰真实 ~/.dsh：用临时目录顶替 STATE_DIR。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'court-store-'));
// store.js 在 import 时就按 os.homedir() 算路径，所以先改 homedir 再动态 import。
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const { read, readProblem, update, stateFilePath } = await import('../store.js');

const STATE_FILE = stateFilePath();

async function reset(home) {
  await fs.rm(path.join(home, '.dsh', 'court'), { recursive: true, force: true });
}

test('全新安装：文件不存在时可以正常写第一份状态', async () => {
  await reset(HOME);
  await update((state) => {
    state.projects.p1 = {
      id: 'p1',
      name: '第一个项目',
      status: 'draft',
      shape: 'squad',
      createdAt: 1,
      updatedAt: 1,
      milestones: [],
    };
  });
  const raw = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  assert.equal(Object.keys(raw.projects).length, 1);
  assert.equal(raw.projects.p1.shape, 'squad');
});

test('空状态守卫：磁盘上有项目时，绝不允许写一个 0 项目的文件', async () => {
  await reset(HOME);
  // 直接铺一份「有项目」的真身
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const seeded = {
    version: 4,
    seq: 7,
    settings: {},
    projects: {
      keep: { id: 'keep', name: '不能丢的项目', status: 'done', createdAt: 1, updatedAt: 1, briefs: [{ id: 'b1', kind: 'report', title: 't' }] },
    },
    vault: {},
  };
  await fs.writeFile(STATE_FILE, JSON.stringify(seeded), 'utf8');

  // 模拟「内存里是空状态」的那台进程：直接调 persist 的守卫路径（通过 update 传空 mutator 不清项目）
  // 这里用一个故意清空 projects 的 mutator
  await assert.rejects(
    () => update((state) => {
      state.projects = {};
    }),
    /空状态守卫/,
  );

  const after = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  assert.equal(Object.keys(after.projects).length, 1, '文件必须原样保留');
  assert.ok(after.projects.keep.briefs.length === 1);
});

test('每次写盘都留一份 .prev，出事了能手工救回', async () => {
  await reset(HOME);
  await update((state) => {
    state.projects.a = { id: 'a', name: 'A', status: 'draft', milestones: [] };
  });
  await update((state) => {
    state.projects.a.name = 'A2';
  });
  const prev = JSON.parse(await fs.readFile(`${STATE_FILE}.prev`, 'utf8'));
  assert.equal(prev.projects.a.name, 'A', 'prev 必须是上一版，不是当前版');
  const now = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  assert.equal(now.projects.a.name, 'A2');
});

test('状态文件损坏：读盘报错并拒绝写入，不覆盖原件', async () => {
  const home2 = await fs.mkdtemp(path.join(os.tmpdir(), 'court-store-corrupt-'));
  const dir = path.join(home2, '.dsh', 'court');
  await fs.mkdir(dir, { recursive: true });
  const broken = '{ 这不是 JSON';
  await fs.writeFile(path.join(dir, 'court.json'), broken, 'utf8');

  const script = `
    const { readProblem, update, stateFilePath } = await import(${JSON.stringify(new URL('../store.js', import.meta.url).href)});
    const state = await (await import(${JSON.stringify(new URL('../store.js', import.meta.url).href)})).read();
    console.log('problem=' + String(readProblem()));
    try {
      await update((s) => { s.projects.x = { id: 'x', name: 'x' }; });
      console.log('WRITE_OK');
    } catch (error) {
      console.log('WRITE_BLOCKED=' + /状态文件读取失败|空状态守卫/.test(error.message));
    }
    console.log('file=' + stateFilePath());
  `;
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, HOME: home2, USERPROFILE: home2 },
    encoding: 'utf8',
  });
  assert.match(out, /problem=状态文件损坏/);
  assert.match(out, /WRITE_BLOCKED=true/);
  assert.equal(await fs.readFile(path.join(dir, 'court.json'), 'utf8'), broken, '原件一个字节都不能动');
});

test('readProblem 干净时为 null', async () => {
  assert.equal(readProblem(), null);
  const state = await read();
  assert.ok(state && typeof state === 'object');
});
