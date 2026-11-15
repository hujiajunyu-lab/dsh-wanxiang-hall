/**
 * 开工基线 / 交付对比
 *
 * 思路：开工前给工作区拍一张“文件清单照片”（路径 + 大小 + 修改时间），
 * 交付时再拍一张，对比出「新增 / 删除 / 修改」。
 * 只存清单不存全文，所以很快；清单体积大，单独放在 ~/.dsh/court/baselines/。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const run = promisify(execFile);

const COURT_DIR = process.env.COURT_STATE_DIR
  ? path.resolve(process.env.COURT_STATE_DIR)
  : path.join(os.homedir(), '.dsh', 'court');
const BASELINE_DIR = path.join(COURT_DIR, 'baselines');

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
]);

const MAX_FILES = 8000;
const MAX_REPORT = 40;

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function gitCommit(dirPath) {
  try {
    const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: dirPath, timeout: 15000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function walk(root) {
  const files = {};
  let count = 0;
  let truncated = false;

  async function visit(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= MAX_FILES) {
        truncated = true;
        return;
      }
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await visit(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        try {
          const info = await fs.stat(path.join(dir, entry.name));
          files[rel] = { size: info.size, mtime: Math.round(info.mtimeMs) };
          count += 1;
        } catch {
          /* 读不到就跳过 */
        }
      }
    }
  }

  await visit(root, '');
  return { files, count, truncated };
}

/** 拍一张基线。 */
export async function takeSnapshot(dirPath) {
  const hasGit = await exists(path.join(dirPath, '.git'));
  const commit = hasGit ? await gitCommit(dirPath) : null;
  const { files, count, truncated } = await walk(dirPath);
  return { kind: commit ? 'git' : 'files', at: Date.now(), commit, count, truncated, files };
}

export async function saveBaseline(projectId, snapshot) {
  await fs.mkdir(BASELINE_DIR, { recursive: true });
  await fs.writeFile(path.join(BASELINE_DIR, `${projectId}.json`), JSON.stringify(snapshot), 'utf8');
}

/** 迁移工作区前把旧基线留档，避免直接覆盖。 */
export async function archiveBaseline(projectId) {
  try {
    const raw = await fs.readFile(path.join(BASELINE_DIR, `${projectId}.json`), 'utf8');
    await fs.writeFile(path.join(BASELINE_DIR, `${projectId}-${Date.now()}.json`), raw, 'utf8');
  } catch {
    /* 没有旧基线就算了 */
  }
}

export async function loadBaseline(projectId) {
  try {
    const raw = await fs.readFile(path.join(BASELINE_DIR, `${projectId}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 和基线对比，返回可读的差异摘要。 */
export async function diffSnapshot(dirPath, baseline) {
  if (!baseline || !baseline.files) return null;
  const current = await walk(dirPath);
  const before = baseline.files;
  const added = [];
  const removed = [];
  const modified = [];

  for (const [rel, meta] of Object.entries(current.files)) {
    const prev = before[rel];
    if (!prev) added.push(rel);
    else if (prev.size !== meta.size || prev.mtime !== meta.mtime) modified.push(rel);
  }
  for (const rel of Object.keys(before)) {
    if (!current.files[rel]) removed.push(rel);
  }

  const summary = {
    at: Date.now(),
    baseAt: baseline.at,
    commit: baseline.commit,
    addedCount: added.length,
    removedCount: removed.length,
    modifiedCount: modified.length,
    added: added.slice(0, MAX_REPORT),
    removed: removed.slice(0, MAX_REPORT),
    modified: modified.slice(0, MAX_REPORT),
    truncated: current.truncated || Boolean(baseline.truncated),
  };
  return summary;
}

/** 删除项目时清掉基线文件。 */
export async function removeBaseline(projectId) {
  try {
    await fs.unlink(path.join(BASELINE_DIR, `${projectId}.json`));
  } catch {
    /* 没有就算了 */
  }
}

/** 宿主侧独立核验：文件/目录计数、逐文件 sha256、相对基线的改动。 */
export async function verifyWorkspace(dirPath, baseline, { includeHashes = true, maxHashes = 200 } = {}) {
  const hashes = [];
  let files = 0;
  let dirs = 0;
  let totalBytes = 0;
  let truncated = false;

  async function visit(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        dirs += 1;
        await visit(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        try {
          const full = path.join(dir, entry.name);
          const info = await fs.stat(full);
          files += 1;
          totalBytes += info.size;
          if (!includeHashes) continue;
          if (hashes.length >= maxHashes) {
            truncated = true;
            continue;
          }
          let sha = '';
          if (info.size <= 5 * 1024 * 1024) {
            sha = createHash('sha256').update(await fs.readFile(full)).digest('hex');
          }
          hashes.push({ path: rel, bytes: info.size, sha256: sha });
        } catch {
          /* 跳过读不到的文件 */
        }
      }
    }
  }

  await visit(dirPath, '');

  let changed = [];
  if (baseline && baseline.files) {
    const diff = await diffSnapshot(dirPath, baseline);
    changed = [...diff.added, ...diff.modified, ...diff.removed.map((rel) => `${rel}（已删除）`)];
    if (diff.truncated) truncated = true;
  }

  return {
    workspace: dirPath,
    files,
    dirs,
    totalBytes,
    hashes,
    truncated,
    changed,
  };
}

/** 把差异写成验收消息里的一段。 */export function formatDiff(diff) {
  if (!diff) {
    return ['—— 本次改动 ——', '（这个项目没有开工基线，无法自动核对改了哪些文件）'].join('\n');
  }
  const lines = [
    '—— 本次改动（相对开工基线，来自文件指纹对比，不是执行者的自述）——',
    `新增 ${diff.addedCount} · 修改 ${diff.modifiedCount} · 删除 ${diff.removedCount}`,
  ];
  if (diff.added.length > 0) lines.push(`新增：${diff.added.join('、')}`);
  if (diff.modified.length > 0) lines.push(`修改：${diff.modified.join('、')}`);
  if (diff.removed.length > 0) lines.push(`删除：${diff.removed.join('、')}`);
  if (diff.truncated) lines.push('（文件太多，清单只列了一部分）');
  if (diff.addedCount === 0 && diff.modifiedCount === 0 && diff.removedCount === 0) {
    lines.push('工作区一个文件都没动。');
  }
  return lines.join('\n');
}
