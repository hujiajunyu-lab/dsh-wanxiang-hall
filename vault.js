/**
 * 知识库：把项目经验投递给 LLM Wiki，以及只读检索。
 *
 * 关键约束（来自 LLM Wiki 自身）：
 * - 外部进程直接写 wiki/*.md 不会被 LLM Wiki 索引，也不会出现在左侧知识库列表；
 * - 唯一有效的写入通道是 raw/sources：LLM Wiki 的 source watcher 会导入它，
 *   再由它生成 wiki/sources、concepts、entities 等正式页面。
 *
 * 所以这里只写 raw/sources/dsh-court/<日期>-<项目>.md，不写 wiki/，也不改 wiki/index.md/log.md
 * （index/log 由 LLM Wiki 自己维护）。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { progressOf } from './store.js';

const MAX_FILES = 400;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SNIPPET = 160;

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function slug(text, fallback = 'dsh-project') {
  const value = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\s_]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return value || fallback;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function yamlList(values) {
  return `[${(values || []).map(yamlString).join(', ')}]`;
}

function compact(text, max = 4000) {
  const value = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n…（已截断，完整内容见万象工阁项目详情）`;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isVaultRoot(root) {
  if (!root) return false;
  return await exists(path.join(root, 'schema.md'))
    && await exists(path.join(root, 'wiki', 'index.md'))
    && await exists(path.join(root, 'raw', 'sources'));
}

/**
 * 解析 LLM Wiki 根目录：
 * - 配置指向根 → 用；
 * - 配置指向 <root>/wiki → 用父目录；
 * - 配置是旧目录 → 在同级目录里找唯一的 schema.md + wiki/index.md + raw/sources。
 */
export async function resolveVaultRoot(vaultPath) {
  const configured = String(vaultPath ?? '').trim();
  if (!configured) throw new Error('知识库路径未配置');

  if (await isVaultRoot(configured)) return { root: configured, resolved: 'configured' };
  if (path.basename(configured).toLowerCase() === 'wiki') {
    const parent = path.dirname(configured);
    if (await isVaultRoot(parent)) return { root: parent, resolved: 'parent-of-wiki' };
  }

  const parent = path.dirname(configured);
  let entries = [];
  try {
    entries = await fs.readdir(parent, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const candidate = path.join(parent, entry.name);
    if (await isVaultRoot(candidate)) candidates.push(candidate);
  }
  if (candidates.length === 1) return { root: candidates[0], resolved: 'sibling' };
  if (candidates.length > 1) {
    throw new Error(
      `知识库路径不是 LLM Wiki 根目录，且同级有多个候选：${candidates.join('、')}；请在知识库页明确设置根目录`,
    );
  }
  throw new Error(
    `知识库路径不是 LLM Wiki 根目录（缺少 schema.md / wiki/index.md / raw/sources）：${configured}；` +
    '请把路径设置到 LLM Wiki 根目录，例如包含 wiki/entities 的那一层',
  );
}

export async function validateVaultRoot(vaultPath) {
  return resolveVaultRoot(vaultPath);
}

function latestBrief(project, kind) {
  return [...project.briefs].reverse().find((brief) => brief.kind === kind) ?? null;
}

function sameContent(existing, next) {
  const normalize = (text) => String(text ?? '')
    .replace(/^(created|updated):.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalize(existing) === normalize(next);
}

function buildSource(project, diff, filename) {
  const plan = latestBrief(project, 'plan');
  const report = latestBrief(project, 'report');
  const verdict = project.latestVerdict || null;
  const mustFix = verdict?.mustFix || [];
  const notes = verdict?.notes || [];
  const today = stamp();
  const tags = [...(project.tags || []), '万象工阁', '项目源文件'];
  const milestones = project.milestones
    .map((item) => `- [${item.done ? 'x' : ' '}] ${item.title}（${item.weight}%）`)
    .join('\n');
  const checks = (project.checks || [])
    .map((check) => `- \`${check.command}\`${check.cwd ? `（cwd: ${check.cwd}）` : ''}`)
    .join('\n');
  const changes = diff
    ? [
      `新增 ${diff.addedCount} · 修改 ${diff.modifiedCount} · 删除 ${diff.removedCount}`,
      diff.added.length ? `新增：${diff.added.join('、')}` : '',
      diff.modified.length ? `修改：${diff.modified.join('、')}` : '',
      diff.removed.length ? `删除：${diff.removed.join('、')}` : '',
    ].filter(Boolean).join('\n')
    : '（没有开工基线，未记录改动清单）';

  return [
    '---',
    'type: source',
    `title: ${yamlString(`万象工阁项目：${project.name}`)}`,
    `created: ${today}`,
    `updated: ${today}`,
    `tags: ${yamlList(tags)}`,
    'related: []',
    'authors: []',
    `year: ${new Date().getFullYear()}`,
    'url: ""',
    'venue: "万象工阁项目"',
    `sources: ${yamlList([`dsh-court/${filename}`])}`,
    '---',
    '',
    `# 万象工阁项目：${project.name}`,
    '',
    '## 一句话概括',
    '',
    compact(project.description || project.name, 400),
    '',
    '## 项目背景',
    '',
    `- 状态：${project.status}　进度：${progressOf(project)}%　驳回：${project.rounds} 轮`,
    `- 编制：${project.shape === 'crew' ? '完整岗位' : project.shape === 'line' ? '批量工单' : '轻量岗位'}`,
    project.workspace?.id ? `- 工作区 id：\`${project.workspace.id}\`` : '',
    `- 工作区：\`${project.workspace ? project.workspace.path : '未指定'}\``,
    project.scope?.original
      ? `- 需求基线：${compact(project.scope.original, 1200)}`
      : '',
    project.scope?.drift
      ? `- 需求漂移：${project.scope.drift.reason}（${new Date(project.scope.drift.at).toISOString()}）`
      : '',
    '',
    '## 方案摘要',
    '',
    compact(plan?.content || plan?.summary || '（没有方案）', 6000),
    '',
    '## 交付报告',
    '',
    compact(report?.content || '（没有交付报告）', 6000),
    '',
    '## 验收命令',
    '',
    checks || '（没有登记验收命令）',
    '',
    '## 审核结论',
    '',
    verdict
      ? [
        `- 结论：${verdict.decision}（${verdict.phase || 'review'}）`,
        mustFix.length ? '### 必须修复' : '',
        ...mustFix.map((item, index) => `${index + 1}. ${item.issue}${item.evidence ? `（${item.evidence}）` : ''}`),
        notes.length ? '### 备注' : '',
        ...notes.map((note) => `- ${note}`),
      ].filter(Boolean).join('\n')
      : '（没有结构化审核记录）',
    '',
    '## 里程碑',
    '',
    milestones || '（没有里程碑）',
    '',
    '## 代码改动',
    '',
    changes,
    '',
    '## 可复用经验',
    '',
    '- 方案修订用 find/replace 补丁，不重发全文；每轮只处理 mustFix。',
    '- 文档一致性/措辞问题不阻塞，实质可验证问题才进 mustFix。',
    '- 结项前由评审独立跑验收命令；Windows 默认用 cmd，不用 PowerShell 5.1 跑 `&&`。',
    '- 环境级失败和代码问题分开记录，避免把“宿主 shell 不通”当成代码缺陷。',
    '',
    '## 待解决问题',
    '',
    (project.questions || []).filter((q) => q.status === 'open').length
      ? (project.questions || [])
        .filter((q) => q.status === 'open')
        .map((q) => `- ${q.question}`)
        .join('\n')
      : mustFix.length
        ? mustFix.map((item) => `- ${item.issue}`).join('\n')
        : '（没有未解决问题）',
    '',
    '## 写入说明',
    '',
    `由万象工阁在 ${today} 写入 raw/sources/dsh-court/，等待 LLM Wiki 的 source watcher 导入。`,
    '',
  ].filter((line) => line !== null && line !== undefined).join('\n');
}

export async function writeEntry(vaultPath, project, diff) {
  const { root, resolved } = await resolveVaultRoot(vaultPath);
  const filename = `${stamp()}-${slug(project.name)}.md`;
  const rel = path.join('raw', 'sources', 'dsh-court', filename).replace(/\\/g, '/');
  const target = path.join(root, rel);
  const content = buildSource(project, diff, filename);

  if (await exists(target)) {
    const existing = await fs.readFile(target, 'utf8').catch(() => '');
    if (sameContent(existing, content)) {
      return {
        root,
        resolved,
        primary: target,
        files: [{ type: 'source', path: target, rel, skipped: true }],
        skipped: true,
      };
    }
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${content.replace(/\s+$/, '')}\n`, 'utf8');

  return {
    root,
    resolved,
    primary: target,
    files: [{ type: 'source', path: target, rel, skipped: false }],
    skipped: false,
  };
}

/**
 * 检查 LLM Wiki 是否已经把 raw source 导入成正式页面。
 * 只认 wiki/sources 与 wiki/concepts（这两个是导入器生成的），
 * 不把 1.4 直写的 wiki/entities 影子页算作“已导入”。
 */
export async function inspectVault(vaultPath, project) {
  const { root } = await resolveVaultRoot(vaultPath);
  const filename = `${stamp()}-${slug(project.name)}.md`;
  const rawRel = path.join('raw', 'sources', 'dsh-court', filename).replace(/\\/g, '/');
  const raw = path.join(root, rawRel);
  const rawExists = await exists(raw);
  const needle = slug(project.name);
  const files = [];
  await walkMarkdown(path.join(root, 'wiki'), files, 0);

  const imported = [];
  for (const file of files) {
    if (imported.length >= 20) break;
    const rel = path.relative(root, file.path).replace(/\\/g, '/');
    if (!/^wiki\/(sources|concepts)\//.test(rel)) continue;
    let text = '';
    try {
      text = await fs.readFile(file.path, 'utf8');
    } catch {
      continue;
    }
    if (text.includes(project.name) || text.includes(`dsh-court/${filename}`) || text.includes(needle)) {
      imported.push({
        type: rel.startsWith('wiki/sources/') ? 'source' : 'concept',
        rel,
        path: file.path,
      });
    }
  }

  return {
    root,
    raw,
    rawRel,
    rawExists,
    imported,
    importedCount: imported.length,
    importedSource: imported.some((page) => page.type === 'source'),
    done: imported.some((page) => page.type === 'source'),
  };
}

async function walkMarkdown(root, out, depth) {
  if (depth > 6 || out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(full, out, depth + 1);
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      try {
        const info = await fs.stat(full);
        if (info.size <= MAX_FILE_BYTES) out.push({ path: full, size: info.size, mtime: info.mtimeMs });
      } catch {
        /* 跳过读不到的文件 */
      }
    }
  }
}

/** 只读检索：优先检索 wiki/ 结构化页面；返回命中片段，供 agent 参考。 */
export async function searchVault(vaultPath, query, limit = 5) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) throw new Error('查询词不能为空');
  const { root } = await resolveVaultRoot(vaultPath);

  const files = [];
  await walkMarkdown(path.join(root, 'wiki'), files, 0);
  if (files.length === 0) await walkMarkdown(root, files, 0);
  files.sort((a, b) => b.mtime - a.mtime);

  const hits = [];
  for (const file of files) {
    if (hits.length >= limit) break;
    let text;
    try {
      text = await fs.readFile(file.path, 'utf8');
    } catch {
      continue;
    }
    const index = text.toLowerCase().indexOf(needle);
    if (index < 0) continue;
    const start = Math.max(0, index - SNIPPET);
    const end = Math.min(text.length, index + needle.length + SNIPPET);
    hits.push({
      path: file.path,
      snippet: (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : ''),
    });
  }
  return { scanned: files.length, hits, root };
}
