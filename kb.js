/**
 * 公司级知识库（企业智库）。
 *
 * 与 vault.js 的分工：
 * - vault.js 是「对外出口」：把单个项目的复盘写成 raw/sources 交给外部 LLM Wiki 索引；
 * - 这里 kb.js 是「内部记忆」：跨项目沉淀的结论，立项与移交时自动注入，让新项目不必重新摸一遍。
 *
 * 三条设计原则：
 * 1. 结论要能独立成立：一条知识 = 一句判断 + 必要的证据/路径，不依赖上下文才能读懂。
 * 2. 出处必须可追：每条都记 projectId / briefId，将来发现错了能回溯是哪次交付得出的结论。
 * 3. 检索不靠向量也能用：中文按二元组切、英文按词切，标题权重最高，标签次之，正文最低。
 */

import { num, str } from './store.js';

export const KB_KINDS = ['decision', 'constraint', 'pitfall', 'pattern', 'tool', 'glossary', 'client'];

export const KB_KIND_LABEL = {
  decision: '决策',
  constraint: '约定',
  pitfall: '坑',
  pattern: '做法',
  tool: '工具',
  glossary: '术语',
  client: '客户偏好',
};

export const KB_KIND_HINT = {
  decision: '为什么选这条路的结论，含被否掉的方案',
  constraint: '以后都要遵守的硬规则（编码/编码/路径/权限）',
  pitfall: '踩过的坑：现象、原因、正确做法',
  pattern: '可复用的实现套路',
  tool: '某个工具/命令的真实用法与边界',
  glossary: '业务术语、字段含义、口径',
  client: '客户的偏好与禁忌（语气、审美、验收习惯）',
};

export const KB_MAX_ENTRIES = 500;
export const KB_MAX_BODY = 8000;
export const KB_MAX_TAGS = 10;
export const KB_MAX_TAG_LEN = 24;
export const KB_INJECT_MAX = 5;

function clampText(value, max) {
  return str(value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function uniqueTags(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const tag = clampText(raw, KB_MAX_TAG_LEN).toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= KB_MAX_TAGS) break;
  }
  return out;
}

/** 中文别名：模型写「坑」「约定」比写 pitfall 顺手，别因为它记了个中文就落回 pattern。 */
const KB_KIND_ALIASES = new Map();
for (const key of KB_KINDS) {
  KB_KIND_ALIASES.set(key, key);
  KB_KIND_ALIASES.set(KB_KIND_LABEL[key], key);
}
KB_KIND_ALIASES.set('风险', 'pitfall');
KB_KIND_ALIASES.set('坑点', 'pitfall');
KB_KIND_ALIASES.set('规则', 'constraint');
KB_KIND_ALIASES.set('规范', 'constraint');
KB_KIND_ALIASES.set('经验', 'pattern');
KB_KIND_ALIASES.set('方案', 'decision');
KB_KIND_ALIASES.set('偏好', 'client');
KB_KIND_ALIASES.set('名词', 'glossary');

export function kbKind(value) {
  const key = str(value).trim().toLowerCase();
  if (KB_KIND_ALIASES.has(key)) return KB_KIND_ALIASES.get(key);
  return 'pattern';
}

export function normalizeEntry(raw, now = Date.now()) {
  const id = str(raw?.id) || `kb_${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return {
    id,
    kind: kbKind(raw?.kind),
    title: clampText(raw?.title, 120) || '（无标题）',
    body: clampText(raw?.body, KB_MAX_BODY),
    tags: uniqueTags(raw?.tags),
    projectId: str(raw?.projectId) || null,
    projectName: clampText(raw?.projectName, 80),
    briefId: str(raw?.briefId) || null,
    source: clampText(raw?.source, 40) || 'manual',
    pinned: raw?.pinned === true,
    confidence: Math.max(0, Math.min(3, num(raw?.confidence, 2))),
    hits: Math.max(0, num(raw?.hits)),
    createdAt: num(raw?.createdAt, now),
    updatedAt: num(raw?.updatedAt, now),
    by: str(raw?.by) || null,
  };
}

export function normalizeKb(raw) {
  const now = Date.now();
  const list = Array.isArray(raw?.entries) ? raw.entries : [];
  const entries = list.slice(0, KB_MAX_ENTRIES).map((entry) => normalizeEntry(entry, now));
  return { entries };
}

/** 中文按二元组、英文按词切；标点与空白一律丢弃。 */
export function tokenize(text) {
  const value = str(text).toLowerCase();
  const tokens = new Set();
  for (const word of value.match(/[a-z0-9_.#$-]{2,}/g) || []) tokens.add(word);
  const cjk = value.replace(/[^\u4e00-\u9fa5]+/g, ' ');
  for (const chunk of cjk.split(/\s+/)) {
    if (!chunk) continue;
    for (let i = 0; i < chunk.length - 1; i += 1) tokens.add(chunk.slice(i, i + 2));
    if (chunk.length === 1) tokens.add(chunk);
  }
  return [...tokens];
}

function scoreEntry(entry, tokens) {
  if (tokens.length === 0) return 0;
  const title = tokenize(entry.title).join(' ');
  const tags = entry.tags.join(' ');
  const body = tokenize(entry.body).join(' ');
  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 6;
    if (tags.includes(token)) score += 4;
    if (body.includes(token)) score += 1;
  }
  if (score > 0) score += Math.min(3, entry.confidence);
  if (entry.pinned) score += 2;
  return score;
}

export function searchEntries(entries, query, { kind = null, tag = null, limit = 20, projectId = null } = {}) {
  const tokens = tokenize(query);
  const wantedKind = kind ? kbKind(kind) : null;
  const rows = [];
  for (const entry of entries || []) {
    if (wantedKind && entry.kind !== wantedKind) continue;
    if (tag && !entry.tags.includes(str(tag).toLowerCase())) continue;
    if (projectId && entry.projectId !== projectId) continue;
    const score = tokens.length ? scoreEntry(entry, tokens) : 1;
    if (tokens.length && score <= 0) continue;
    rows.push({ entry, score });
  }
  rows.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt);
  return rows.slice(0, Math.max(1, limit)).map((row) => ({ ...row.entry, score: row.score }));
}

/**
 * 立项/移交时挑哪几条注入。
 *
 * 打分顺序：置顶 > 与项目技术栈/约定/名称命中的标签 > 高置信 > 新。同一项目的旧条目照样能用
 * （承接场景），所以不排除 projectId，只是不加分。
 */
export function pickForContext(entries, project, limit = KB_INJECT_MAX) {
  const haystack = [
    project?.name,
    project?.description,
    project?.context?.stack,
    project?.context?.conventions,
    ...(project?.context?.topPaths || []),
    ...(project?.ownership || []),
  ]
    .filter(Boolean)
    .join(' ');
  const tokens = tokenize(haystack);
  const rows = [];
  for (const entry of entries || []) {
    let score = entry.pinned ? 100 : 0;
    score += entry.confidence * 2;
    for (const tag of entry.tags) {
      if (tokens.includes(tag) || haystack.toLowerCase().includes(tag)) score += 8;
    }
    score += Math.min(6, entry.hits);
    rows.push({ entry, score });
  }
  rows.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt);
  return rows.slice(0, Math.max(0, limit)).map((row) => row.entry);
}

export function entryLine(entry) {
  const label = KB_KIND_LABEL[entry.kind] || entry.kind;
  const tags = entry.tags.length ? `〔${entry.tags.slice(0, 3).join('/')}〕` : '';
  const title = entry.title.length > 46 ? `${entry.title.slice(0, 46)}…` : entry.title;
  return `- [${label}]${tags} ${title}（kb:${entry.id}）`;
}

export function kbStats(entries) {
  const byKind = {};
  for (const kind of KB_KINDS) byKind[kind] = 0;
  let pinned = 0;
  for (const entry of entries || []) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    if (entry.pinned) pinned += 1;
  }
  return { total: (entries || []).length, pinned, byKind };
}

/**
 * 从项目里提炼候选条目。
 *
 * 不做「让模型总结一遍」的事——那是另一次模型调用的成本。这里只做确定性的拆条：
 * 约定 / 坑 / 技术栈各成一条，交付说明与验收文书里的编号条目各成一条。
 * 秘书或用户看过之后再决定收哪几条（court_kb_save）。
 */
export function digestCandidates(project, entries = [], now = Date.now()) {
  const seen = new Set((entries || []).map((entry) => entry.title));
  const out = [];
  const push = (kind, title, body, extra = {}) => {
    const clean = clampText(title, 120);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push(
      normalizeEntry(
        {
          kind,
          title: clean,
          body: clampText(body, KB_MAX_BODY),
          tags: extra.tags || [],
          projectId: project?.id || null,
          projectName: project?.name || '',
          briefId: extra.briefId || null,
          source: 'digest',
          createdAt: now,
          updatedAt: now,
        },
        now,
      ),
    );
  };

  const stack = str(project?.context?.stack);
  if (stack) push('tool', `${project.name}：技术栈与运行环境`, stack, { tags: ['技术栈'] });

  const conventions = str(project?.context?.conventions);
  if (conventions) {
    for (const line of conventions.split(/\n|；|;/)) {
      const text = line.replace(/^[-*\d.\s、]+/, '').trim();
      if (text.length >= 6) push('constraint', text.slice(0, 100), text, { tags: ['约定'] });
    }
  }

  const gotchas = str(project?.context?.gotchas);
  if (gotchas) {
    for (const line of gotchas.split(/\n/)) {
      const text = line.replace(/^[-*\d.\s、]+/, '').trim();
      if (text.length >= 6) push('pitfall', text.slice(0, 100), text, { tags: ['坑'] });
    }
  }

  const briefs = Array.isArray(project?.briefs) ? project.briefs : [];
  for (const brief of briefs) {
    if (!['closing', 'report', 'acceptance'].includes(brief.kind)) continue;
    const body = str(brief.content);
    const lines = body.split(/\n/);
    for (const line of lines) {
      const match = line.match(/^\s*(?:\d+[.、)]|[-*])\s*(.{8,120})$/);
      if (!match) continue;
      const title = match[1].trim();
      if (/^https?:/i.test(title)) continue;
      // 交付/验收/结项文书里的结论行，本质都是「这次我们决定了什么」
      push('decision', title, `${title}\n\n（出自《${brief.title || brief.kind}》）`, {
        briefId: brief.id,
        tags: [brief.kind],
      });
    }
  }

  return out.slice(0, 12);
}

export function toMarkdown(entries, { title = '万象工阁 · 公司知识库', now = new Date() } = {}) {
  const header = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `exportedAt: ${JSON.stringify(now.toISOString())}`,
    `entries: ${(entries || []).length}`,
    '---',
    '',
  ];
  const groups = new Map();
  for (const entry of entries || []) {
    if (!groups.has(entry.kind)) groups.set(entry.kind, []);
    groups.get(entry.kind).push(entry);
  }
  const body = [];
  for (const kind of KB_KINDS) {
    const list = groups.get(kind);
    if (!list || list.length === 0) continue;
    body.push(`## ${KB_KIND_LABEL[kind]}（${list.length}）`, '');
    for (const entry of list) {
      body.push(`### ${entry.title}`, '');
      if (entry.tags.length) body.push(`标签：${entry.tags.join('、')}`, '');
      body.push(entry.body || '', '');
      const from = entry.projectName || entry.projectId || '未记项目';
      body.push(`出处：${from}${entry.briefId ? ` · 文书 ${entry.briefId}` : ''}`, '');
    }
  }
  return `${header.join('\n')}${body.join('\n')}`;
}
