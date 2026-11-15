/**
 * 交付 diff：优先用 git 基线，给出 stat + 有界 unified diff；不是 git 就明确说不可用。
 * 只读，不修改工作区。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const MAX_PATCH_BYTES = 200 * 1024;
const DEFAULT_PATCH_BYTES = 120 * 1024;
const MAX_PATHS = 20;

async function hasGit(dirPath) {
  try {
    await fs.access(path.join(dirPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

function cleanPaths(paths) {
  if (!Array.isArray(paths)) return [];
  const out = [];
  for (const raw of paths.slice(0, MAX_PATHS)) {
    const value = String(raw ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!value || value.startsWith('/') || /^[a-zA-Z]:/.test(value) || value.split('/').includes('..')) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

function parseStatus(text) {
  const changed = new Set();
  const untracked = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    let rest = line.slice(3).trim();
    if (rest.includes(' -> ')) rest = rest.split(' -> ').pop().trim();
    if (code.includes('?')) untracked.add(rest);
    else changed.add(rest);
  }
  return { changed: [...changed], untracked: [...untracked] };
}

/**
 * @returns {Promise<{available:boolean, reason:string, base:string, stat:string, patch:string, truncated:boolean, changed:string[], untracked:string[]}>}
 */
export async function gitDiff(dirPath, baseline, { maxBytes = DEFAULT_PATCH_BYTES, paths = [] } = {}) {
  const empty = {
    available: false,
    reason: '',
    base: '',
    stat: '',
    patch: '',
    truncated: false,
    changed: [],
    untracked: [],
  };
  if (!dirPath) return { ...empty, reason: '项目还没有工作区' };
  if (!(await hasGit(dirPath))) return { ...empty, reason: '工作区不是 git 仓库，无法生成内容 diff；请看文件清单/hash' };

  const base = baseline && baseline.commit ? String(baseline.commit) : '';
  const wanted = cleanPaths(paths);
  const pathArgs = wanted.length > 0 ? ['--', ...wanted] : [];

  let status = '';
  try {
    const result = await run('git', ['-C', dirPath, 'status', '--porcelain=v1', ...pathArgs], {
      cwd: dirPath,
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    status = result.stdout;
  } catch (error) {
    return { ...empty, reason: `git status 失败：${error?.message ?? error}` };
  }
  const { changed, untracked } = parseStatus(status);

  let stat = '';
  try {
    const result = await run(
      'git',
      ['-C', dirPath, 'diff', '--stat', ...(base ? [base] : []), ...pathArgs],
      { cwd: dirPath, timeout: 20000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    stat = result.stdout;
  } catch {
    /* stat 失败不影响 patch */
  }

  let patch = '';
  try {
    const args = ['-C', dirPath, 'diff', '--no-color', '--unified=3', ...(base ? [base] : []), ...pathArgs];
    const result = await run('git', args, {
      cwd: dirPath,
      timeout: 30000,
      maxBuffer: 12 * 1024 * 1024,
      windowsHide: true,
    });
    patch = result.stdout;
    if (!base) {
      // 没有基线 commit 时，把已暂存的改动也带上。
      const cached = await run('git', ['-C', dirPath, 'diff', '--cached', '--no-color', '--unified=3', ...pathArgs], {
        cwd: dirPath,
        timeout: 20000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      if (cached.stdout.trim()) patch = `${patch}${patch ? '\n' : ''}${cached.stdout}`;
    }
  } catch (error) {
    return {
      ...empty,
      base,
      reason: `git diff 失败：${error?.message ?? error}`,
      changed,
      untracked,
    };
  }

  const limit = Math.min(MAX_PATCH_BYTES, Math.max(20 * 1024, Number(maxBytes) || DEFAULT_PATCH_BYTES));
  const truncated = Buffer.byteLength(patch, 'utf8') > limit;
  if (truncated) {
    patch = Buffer.from(patch, 'utf8').subarray(0, limit).toString('utf8');
  }

  return {
    available: true,
    reason: '',
    base,
    stat,
    patch,
    truncated,
    changed,
    untracked,
  };
}
