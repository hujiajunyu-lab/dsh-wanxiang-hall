/**
 * 上下文索引与文书预算（Step 2）
 *
 * 病根：v1.7 移交时把契约/方案**全文**塞进提示词（超 20000 字符还静默砍到 6000），
 * 于是每移交一次就重发一遍，驳回 6 轮 = 449K 字符。真正该跨省传递的是
 * 「指针 + 结论 + 约定」，全文按需用 court_read_brief 取。
 *
 * 这里只做三件事，全部是纯函数：
 *  1. buildIndex(project)  —— 生成 ≤2000 字符的入场索引（谁/在哪/到哪一步/下一步找谁）
 *  2. BUDGET / budgetOf(kind) —— 每类文书的硬上限（超了直接报错，不静默截断）
 *  3. briefPointer(brief)  —— 一句话指针，替代全文注入
 */

import { SHAPE_META, shapeOf } from './auth.js';
import { KB_KIND_LABEL, pickForContext } from './kb.js';

export const INDEX_MAX_CHARS = 2000;

/** 文书预算：超过就报错，让作者去 patch，而不是把一大段字塞进每一轮对话。 */
export const BUDGET = {
  // 契约实测：一次只读体检 21 条问题 + 6 个待确认项 = 5977 字，
  // 3000 会逼作者砍掉证据反而变模糊，定 6000；更长的证据放 report 附录。
  contract: 6000,
  quote: 1500,
  package: 2000,
  change: 2000,
  architecture: 8000,
  plan: 12000,
  acceptance: 3000,
  closing: 3000,
  brief: 6000,
  report: 6000,
};

export function budgetOf(kind) {
  return Number.isFinite(BUDGET[kind]) ? BUDGET[kind] : 6000;
}

/** 单行压缩：去掉多余空行，截到 n 个字符（带省略号）。 */
function clip(text, n) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= n) return flat;
  return `${flat.slice(0, Math.max(0, n - 1))}…`;
}

function briefLine(brief) {
  const chars = String(brief?.content ?? '').length;
  return `${brief.kind}:${brief.id}「${clip(brief.title, 24)}」${chars}字`;
}

/** 最近 n 份文书的指针行（最新在前）。 */
export function recentBriefs(project, n = 3) {
  const briefs = Array.isArray(project?.briefs) ? project.briefs : [];
  return briefs.slice(-n).reverse().map(briefLine);
}

/** 一个工单/验收项的一行摘要。 */
function checksLine(project) {
  const checks = Array.isArray(project?.checks) ? project.checks : [];
  if (checks.length === 0) return '未登记验收命令（建议先 court_set_checks）';
  return checks
    .slice(0, 5)
    .map((check) => `${check.id}=${clip(check.cmd, 40)}`)
    .join('；');
}

/**
 * 报价与记账：外包公司先报价再施工，做到一半知道「这单已经亏了」比事后复盘有用。
 * 只记能自动记的（返工轮次、验收次数）；token 由报价方自己估，不做假数据。
 */
function quoteLine(project) {
  const quote = project?.quote;
  const actual = project?.actual || {};
  if (!quote || (!quote.rounds && !quote.tokenBudget)) return '';
  const parts = [];
  if (quote.rounds) parts.push(`${quote.rounds} 轮返工`);
  if (quote.tokenBudget) parts.push(`${Math.round(quote.tokenBudget / 1000)}K token`);
  const used = [];
  if (actual.rounds) used.push(`${actual.rounds} 轮`);
  if (actual.verifications) used.push(`${actual.verifications} 次验收`);
  const over = (quote.rounds && actual.rounds > quote.rounds) || false;
  const tail = used.length ? `已用 ${used.join('、')}` : '刚开始';
  return `报价：${parts.join('／')}；${tail}${over ? '（⚠ 轮次已超报价：停下来评估范围）' : ''}`;
}

function packagesLine(project) {
  const packages = Array.isArray(project?.packages) ? project.packages : [];
  if (packages.length === 0) return '未拆工单';
  const doing = packages.filter((p) => p.state === 'doing').length;
  const ready = packages.filter((p) => p.state === 'ready').length;
  const merged = packages.filter((p) => p.state === 'merged').length;
  const blocked = packages.filter((p) => p.state === 'blocked').length;
  return `共 ${packages.length}（进行中 ${doing}／待验收 ${ready}／已合入 ${merged}／阻塞 ${blocked}）`;
}

/**
 * 入场索引：给下一个省的「一页纸」。只放指针与结论，不放正文。
 * 保证长度 ≤ INDEX_MAX_CHARS（先按优先级拼，最后整体兜底截断）。
 */
export function buildIndex(project, options = {}) {
  const max = Number.isFinite(options.maxChars) ? options.maxChars : INDEX_MAX_CHARS;
  const shape = shapeOf(project);
  const meta = SHAPE_META[shape];
  const context = project?.context ?? {};
  const scope = project?.scope ?? {};
  const manual = Array.isArray(project?.manual) ? project.manual : [];
  const pendingManual = manual.filter((item) => item.status !== 'done').length;
  const questions = Array.isArray(project?.questions) ? project.questions : [];

  const blocks = [
    `【索引】项目：${clip(project?.name, 40)}（${project?.id ?? '?'}）｜状态 ${project?.status ?? '?'}｜编制 ${meta.label}`,
    `工作区：${project?.workspace?.path ? clip(project.workspace.path, 70) : '未指定（先要一个现成目录）'}`,
    project?.lineage?.parentId
      ? `承接：${clip(project.lineage.name || project.lineage.parentId, 40)}（同一仓库的后续，会话已接上，不要重新摸底）`
      : '',    scope.original ? `需求基线：${clip(scope.original, 220)}` : '',
    scope.drift ? `⚠ 范围漂移：${clip(scope.drift.reason, 80)}（未确认前不得交付）` : '',
    project?.rounds > 0 ? `驳回轮次：${project.rounds}／上限 ${meta.rejectCap}` : '',
    quoteLine(project),
    `验收：${checksLine(project)}`,
    `工单：${packagesLine(project)}`,
    context.map ? `结构：${clip(context.map, 240)}` : '',
    context.stack ? `技术栈：${clip(context.stack, 120)}` : '',
    context.conventions ? `约定：${clip(context.conventions, 240)}` : '',
    context.gotchas ? `坑：${clip(context.gotchas, 200)}` : '',
    Array.isArray(context.topPaths) && context.topPaths.length > 0
      ? `常改文件：${context.topPaths.slice(0, 8).map((p) => clip(p, 30)).join('、')}`
      : '',
    `最近文书：${recentBriefs(project, 3).join('；') || '无'}`,
    kbBlock(project, options.kbEntries),
    pendingManual > 0 ? `待用户动手：${pendingManual} 项（做完才能验收）` : '',
    questions.length > 0 ? `待用户回答：${questions.length} 项` : '',
    '正文不要我重发：用 court_read_brief(id) 按需读，读前先看标题判断值不值。',
  ].filter(Boolean);

  let text = blocks.join('\n');
  if (text.length > max) {
    text = `${text.slice(0, Math.max(0, max - 1))}…`;
  }
  return text;
}

/**
 * 公司记忆：从公司知识库里挑几条与本项目相关的结论。
 *
 * 这是「企业智库」唯一的注入点——只在入场索引里放 3 条标题，正文留给
 * court_kb_search 按需查。放开全量会把索引撑爆，也很容易变成噪音。
 */
function kbBlock(project, entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return '';
  const picked = pickForContext(list, project, 3);
  if (picked.length === 0) return '';
  const lines = picked.map((entry) => {
    const label = KB_KIND_LABEL[entry.kind] || entry.kind;
    return `- [${label}]${entry.pinned ? '（铁律）' : ''} ${clip(entry.title, 56)}`;
  });
  return `公司记忆（动手前先看，别重新踩）：\n${lines.join('\n')}`;
}

/** 一句话指针，替代全文注入。 */
export function briefPointer(brief) {
  if (!brief) return '';
  const chars = String(brief.content ?? '').length;
  const budget = budgetOf(brief.kind);
  return `文书：${brief.kind}｜${clip(brief.title, 40)}｜id=${brief.id}｜${chars} 字（预算 ${budget}）`
    + `\n读全文：court_read_brief({id:'${brief.id}'})`;
}

/**
 * 预算检查：超了就抛，并告诉作者怎么改。
 * 不允许静默截断——截断会让「审的人以为看全了」，这是驳回循环的真正燃料。
 */
export function assertBriefBudget(kind, content) {
  const chars = String(content ?? '').length;
  const budget = budgetOf(kind);
  if (chars <= budget) return { chars, budget };
  const hint = kind === 'plan'
    ? '把「结论/接口/文件清单」留在正文，把长篇背景挪到 brief；细则用 court_revise_brief 追加，不要重发全文。'
    : '用 court_revise_brief 打补丁（find/replace），不要重发全文。';
  const error = new Error(
    `文书超预算：${kind} 上限 ${budget} 字符，本次 ${chars} 字符。${hint}`,
  );
  error.code = 'BRIEF_TOO_LONG';
  throw error;
}
