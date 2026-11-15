/**
 * 万象工阁状态存储（宿主侧单一真源）
 *
 * index.js（HTTP 路由）与 tools.js（agent 工具）都从这里读写，保证：
 * - 同一份内存状态、同一条写入队列（模块级单例）
 * - 每次写都是原子写（tmp + rename）
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SHAPES } from './auth.js';
import { normalizeKb } from './kb.js';

/** 状态文件 schema 版本：4 起每个项目带 shape（编制）与工单/上下文容器。 */
export const SCHEMA_VERSION = 4;

/**
 * 知识库（LLM Wiki / Obsidian）路径没有默认值：每家机器不一样，猜一个反而更糟。
 * 空串表示「还没设置」，面板会提示去设置，交付出口相关按钮会明确报错。
 */
export const DEFAULT_VAULT_PATH = '';
export const DEFAULT_COURT_WORKSPACE = path.join(os.homedir(), 'Documents', 'deepseek-harness', '万象工阁');

// 状态目录可用环境变量覆盖（测试与回归用；生产不设就走 ~/.dsh/court）。
const STATE_DIR = process.env.COURT_STATE_DIR
  ? path.resolve(process.env.COURT_STATE_DIR)
  : path.join(os.homedir(), '.dsh', 'court');
const STATE_FILE = path.join(STATE_DIR, 'court.json');
/**
 * 智库单独存一份：条目正文可以到 8K 字，混在 court.json 里会让每次
 * 移交（hits+=1）、每次改状态都重写整个大文件，也把备份撑肥。
 * 这里 court.json 只管项目，kb.json 只管记忆，各自原子写。
 */
const KB_FILE = path.join(STATE_DIR, 'kb.json');

export const DEFAULT_MILESTONES = [
  { title: '需求澄清', weight: 20 },
  { title: '方案定稿', weight: 20 },
  { title: '评审通过', weight: 10 },
  { title: '施工交付', weight: 40 },
  { title: '验收归档', weight: 10 },
];

export const STATUSES = [
  'draft',
  'zhongshu',
  'menxia',
  'shangshu',
  'executing',
  'review',
  'done',
  'archived',
  'blocked',
  // 暂停：不是完成，只是先放下；恢复时回到 pausedFrom 记的那个阶段。
  'paused',
];

const STATUS_SET = new Set(STATUSES);

export const ROLES = ['zhongshu', 'menxia', 'shangshu', 'executor'];

export const ROLE_PRESET = {
  zhongshu: 'court-zhongshu',
  menxia: 'court-menxia',
  shangshu: 'court-shangshu',
  executor: 'court-executor',
};

/** @type {any} */
let state = null;
let chain = Promise.resolve();
let kbSerialized = '';
/**
 * 读盘失败的原因（null=正常）。一旦非空，就禁止任何写入：
 * 宁可让面板报错，也不能拿一份空状态把用户的 24 份文书覆盖掉。
 * 2026-11-15 01:28 就是这么丢过一次数据（迁移时 junction 还没建好 → ENOENT → 空状态 → 备份定时器写盘）。
 */
let readError = null;

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    seq: 0,
    settings: {
      vaultPath: DEFAULT_VAULT_PATH,
      courtWorkspace: DEFAULT_COURT_WORKSPACE,
      secretarySessionId: null,
      // 放权：开启后，万象工阁会话（含新建的）直接落到「完全权限」。
      grantFullAccess: false,
      // 备份模式：开启后定时自动打备份包（纯本地，0 token）。
      backupMode: false,
      // 上一次备份的内容指纹，用来跳过「内容没变」的重复包。
      lastBackupSignature: '',
    },
    projects: {},
    vault: {},
    // 公司级知识库：跨项目结论（kb.js 负责归一与检索）。
    kb: { entries: [] },
    pendingJump: null,
  };
}

export function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export function num(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 路径值兼容：老状态里可能把用户输入的成对引号也存了进来。 */
function cleanPathValue(value) {
  return str(value)
    .trim()
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim();
}

/** 文书的摘要视图：列表/快照只带元数据，正文按需读。 */
export function briefMeta(brief) {
  const content = str(brief?.content);
  return {
    id: str(brief?.id),
    kind: str(brief?.kind, 'brief') || 'brief',
    title: str(brief?.title, '未命名文书'),
    author: str(brief?.author, 'unknown') || 'unknown',
    summary: str(brief?.summary),
    createdAt: num(brief?.createdAt),
    chars: content.length,
    version: num(brief?.version, 1),
  };
}

function normalizeCheck(raw, index) {
  const id = str(raw?.id).trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(id)) return null;
  const command = str(raw?.command).trim();
  if (!command) return null;
  return {
    id,
    command: command.slice(0, 2000),
    timeoutMs: Math.min(15 * 60 * 1000, Math.max(5000, num(raw?.timeoutMs, 5 * 60 * 1000))),
    shell: ['auto', 'cmd', 'pwsh', 'powershell', 'bash'].includes(str(raw?.shell))
      ? str(raw?.shell)
      : 'auto',
  };
}

function normalizeChecks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const [index, item] of raw.entries()) {
    if (out.length >= 10) break;
    const check = normalizeCheck(item, index);
    if (!check || seen.has(check.id)) continue;
    out.push(check);
    seen.add(check.id);
  }
  return out;
}

function normalizeCheckResult(raw) {
  return {
    id: str(raw?.id),
    command: str(raw?.command),
    shell: str(raw?.shell),
    exitCode: num(raw?.exitCode, -1),
    durationMs: num(raw?.durationMs),
    ok: Boolean(raw?.ok),
    timedOut: Boolean(raw?.timedOut),
    truncated: Boolean(raw?.truncated),
    stdoutTail: str(raw?.stdoutTail).slice(-4096),
    stderrTail: str(raw?.stderrTail).slice(-4096),
    logSha256: str(raw?.logSha256),
    logPath: str(raw?.logPath),
    error: str(raw?.error),
  };
}

function normalizeVerifications(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-10).map((item) => ({
    id: str(item?.id),
    at: num(item?.at),
    by: str(item?.by, 'unknown') || 'unknown',
    workspace: str(item?.workspace),
    commit: str(item?.commit) || null,
    ok: Boolean(item?.ok),
    skipped: Boolean(item?.skipped),
    checks: Array.isArray(item?.checks) ? item.checks.slice(0, 10).map(normalizeCheckResult) : [],
  }));
}

function normalizeVerdict(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const decision = raw.decision === 'pass' ? 'pass' : raw.decision === 'reject' ? 'reject' : '';
  if (!decision) return null;
  return {
    id: str(raw.id),
    decision,
    phase: str(raw.phase, 'menxia') || 'menxia',
    mustFix: Array.isArray(raw.mustFix)
      ? raw.mustFix.slice(0, 3).map((item) => ({
        issue: str(item?.issue),
        evidence: str(item?.evidence),
      })).filter((item) => item.issue)
      : [],
    notes: Array.isArray(raw.notes) ? raw.notes.map((item) => str(item)).filter(Boolean).slice(0, 10) : [],
    at: num(raw.at),
  };
}

function normalizeScope(raw, description) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const drift = value.drift && typeof value.drift === 'object'
    ? {
      at: num(value.drift.at),
      by: str(value.drift.by, 'unknown') || 'unknown',
      reason: str(value.drift.reason),
      fromPlanId: str(value.drift.fromPlanId),
      toPlanId: str(value.drift.toPlanId),
    }
    : null;
  return {
    original: str(value.original) || str(description),
    approvedPlanId: str(value.approvedPlanId) || null,
    approvedAt: num(value.approvedAt),
    drift,
    confirmedAt: num(value.confirmedAt),
    confirmedBy: str(value.confirmedBy),
  };
}

function normalizeDept(raw) {
  return {
    sessionId: str(raw?.sessionId) || null,
    state: str(raw?.state, 'idle'),
    note: str(raw?.note) || null,
  };
}

/** 一条「项目参考」最多带多少条消息、单条多少字（宿主侧兜底，客户端也会限制）。 */
export const REFERENCE_MAX_ITEMS = 200;
export const REFERENCE_MAX_CHARS = 4000;

/**
 * 项目参考：用户从某次会话里挑出来的一小段记录，或整段会话。
 * 只保留渲染所需的字段，正文按条截断，避免 court.json 被聊天记录撑爆。
 */
function normalizeReference(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id).trim();
  if (!id) return null;
  const items = Array.isArray(raw.items)
    ? raw.items
      .slice(0, REFERENCE_MAX_ITEMS)
      .map((item) => ({
        role: str(item?.role, 'user') === 'assistant' ? 'assistant' : 'user',
        at: num(item?.at),
        text: str(item?.text).slice(0, REFERENCE_MAX_CHARS),
      }))
      .filter((item) => item.text)
    : [];
  if (items.length === 0) return null;
  return {
    id,
    sessionId: str(raw.sessionId),
    sessionLabel: str(raw.sessionLabel, '会话') || '会话',
    kind: raw.kind === 'session' ? 'session' : 'messages',
    items,
    createdAt: num(raw.createdAt, Date.now()),
    createdBy: str(raw.createdBy, 'user') || 'user',
  };
}

/** 立项时拖进来的附件：只存元数据，字节在 court/attachments/<projectId>/ 下。 */
function normalizeAttachment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id).trim();
  const filePath = str(raw.path).trim();
  if (!id || !filePath) return null;
  return {
    id,
    name: str(raw.name, path.basename(filePath)) || path.basename(filePath),
    bytes: Math.max(0, num(raw.bytes)),
    path: filePath,
    at: num(raw.at, Date.now()),
  };
}

/** 编制：老状态没有 shape，就按老 mode 推（lite→squad，其余 crew）。 */
function normalizeShape(raw) {
  const shape = str(raw?.shape);
  if (SHAPES.includes(shape)) return shape;
  return str(raw?.mode) === 'lite' ? 'squad' : 'crew';
}

/** 血缘：这个项目是从哪个项目派生/延续来的（复用会话与上下文索引的前提）。 */
function normalizeLineage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const parentId = str(raw.parentId).trim();
  if (!parentId) return null;
  return {
    parentId,
    name: str(raw.name).slice(0, 80),
    kind: raw.kind === 'continue' ? 'continue' : 'clone',
    at: num(raw.at, Date.now()),
  };
}

/** 上下文索引：给下一个省的「入场包」，只放指针与约定，不放全文。 */
function normalizeContext(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    map: str(value.map).slice(0, 2000),
    stack: str(value.stack).slice(0, 1000),
    conventions: str(value.conventions).slice(0, 2000),
    gotchas: str(value.gotchas).slice(0, 2000),
    topPaths: Array.isArray(value.topPaths)
      ? value.topPaths.map((item) => str(item).trim()).filter(Boolean).slice(0, 40)
      : [],
    updatedAt: num(value.updatedAt) || null,
  };
}

const PACKAGE_STATES = ['queued', 'doing', 'ready', 'merged', 'blocked'];

/** 工单（work package）：可独立派、可独立验收的最小交付单元。 */
function normalizePackage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id).trim();
  const title = str(raw.title).trim();
  if (!id || !title) return null;
  return {
    id,
    title: title.slice(0, 120),
    goal: str(raw.goal).slice(0, 2000),
    files: Array.isArray(raw.files) ? raw.files.map((f) => str(f).trim()).filter(Boolean).slice(0, 60) : [],
    dod: Array.isArray(raw.dod) ? raw.dod.map((d) => str(d).trim()).filter(Boolean).slice(0, 10) : [],
    state: PACKAGE_STATES.includes(str(raw.state)) ? str(raw.state) : 'queued',
    assignee: str(raw.assignee) || null,
    dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map((d) => str(d)).filter(Boolean).slice(0, 10) : [],
    checkIds: Array.isArray(raw.checkIds) ? raw.checkIds.map((c) => str(c)).filter(Boolean).slice(0, 10) : [],
    createdAt: num(raw.createdAt, Date.now()),
    updatedAt: num(raw.updatedAt, Date.now()),
  };
}

/** 用户操作单：机器做不了、必须由人确认的事项（配密码、开白名单、真机测试）。 */
function normalizeManualItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id).trim();
  const title = str(raw.title).trim();
  if (!id || !title) return null;
  return {
    id,
    title: title.slice(0, 160),
    detail: str(raw.detail).slice(0, 2000),
    status: raw.status === 'done' ? 'done' : 'pending',
    confirmedBy: str(raw.confirmedBy) || null,
    at: num(raw.at, Date.now()),
  };
}

/** 账期：预算与实耗。token 由宿主记账，不折算成钱。 */
function normalizeBudget(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    maxTokens: num(value.maxTokens),
    maxWallMs: num(value.maxWallMs),
    spentTokens: num(value.spentTokens),
    startedAt: num(value.startedAt) || null,
  };
}

/** 实耗：token、驳回轮次、验证次数。计数器，永远有对象。 */
function normalizeActual(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    tokens: num(value.tokens),
    rounds: num(value.rounds),
    verifications: num(value.verifications),
    updatedAt: num(value.updatedAt) || null,
  };
}

/**
 * 时间盒（appetite）：Shape Up 的说法——不是「估多久」，是「愿意花多久」。
 * 到点不自动延期，而是把三选一甩给客户；延期必须留痕（谁批的、加了多少）。
 */
export const APPETITE_MS = {
  squad: 8 * 60 * 60 * 1000,
  crew: 40 * 60 * 60 * 1000,
  // 流水线按条目算，不设总时限：一批 200 个文件本来就不是「一天」的活。
  line: 0,
};

export function normalizeAppetite(raw, shape, createdAt) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const fallback = APPETITE_MS[shape] ?? APPETITE_MS.crew;
  const maxMs = num(value.maxMs) > 0 ? num(value.maxMs) : fallback;
  return {
    maxMs,
    startedAt: num(value.startedAt) || num(createdAt) || null,
    breachedAt: num(value.breachedAt) || null,
    // 每次延期：谁批的、加了多少、为什么。
    extensions: Array.isArray(value.extensions)
      ? value.extensions
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          at: num(item.at, Date.now()),
          by: str(item.by) || 'user',
          addMs: num(item.addMs),
          note: str(item.note).slice(0, 200),
        }))
        .slice(-20)
      : [],
  };
}

/** 四象限键：重要×紧急。顺序与面板格子一致（右上=重要且紧急）。 */
export const QUADRANTS = [
  'important-not-urgent',
  'important-urgent',
  'neither',
  'urgent-not-important',
];

export function normalizePriority(raw) {
  // 缺省是「既不重要也不紧急」：没填就是没排期，不许默认为紧急来插队。
  const value = raw && typeof raw === 'object' ? raw : {};
  return { important: value.important === true, urgent: value.urgent === true };
}

export function quadrantOf(raw) {
  const priority = normalizePriority(raw && raw.priority ? raw.priority : raw);
  if (priority.important && priority.urgent) return 'important-urgent';
  if (priority.important) return 'important-not-urgent';
  if (priority.urgent) return 'urgent-not-important';
  return 'neither';
}

export function normalizeProject(id, raw) {
  const milestones = Array.isArray(raw?.milestones) ? raw.milestones : [];
  const departments = raw?.departments && typeof raw.departments === 'object' ? raw.departments : {};
  const shape = normalizeShape(raw);
  return {
    id,
    name: str(raw?.name, '未命名项目'),
    description: str(raw?.description),
    status: STATUS_SET.has(raw?.status) ? raw.status : 'draft',
    // 暂停前停在哪个阶段：恢复时用得上。
    pausedFrom: STATUS_SET.has(raw?.pausedFrom) && raw.pausedFrom !== 'paused' ? raw.pausedFrom : null,
    pausedAt: num(raw?.pausedAt) || null,
    // 编制：squad 轻量岗位 / crew 完整岗位 / line 批量工单。mode 是 v3 遗留字段，跟着 shape 走。
    shape,
    mode: shape === 'crew' ? 'full' : 'lite',
    rounds: num(raw?.rounds),
    tags: Array.isArray(raw?.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    workspace: raw?.workspace && typeof raw.workspace === 'object'
      ? { id: str(raw.workspace.id), path: cleanPathValue(raw.workspace.path) }
      : null,
    blockedReason: str(raw?.blockedReason) || null,
    lastNote: str(raw?.lastNote) || null,
    approvedBriefId: str(raw?.approvedBriefId) || null,
    lastNudgeAt: num(raw?.lastNudgeAt),
    // 心跳：会话日志的最后写入时间。事实层，不参与状态判定。
    activity: {
      lastAt: num(raw?.activity?.lastAt) || null,
      lastSize: num(raw?.activity?.lastSize) || null,
      nudges: num(raw?.activity?.nudges),
      escalatedAt: num(raw?.activity?.escalatedAt) || null,
    },
    // v4：血缘 / 上下文索引 / 工单 / 归属 / 账期 / 人工事项 / 驳回历史 / 代签
    lineage: normalizeLineage(raw?.lineage),
    linkedSessions: Array.isArray(raw?.linkedSessions)
      ? raw.linkedSessions.slice(-20).map((item) => ({
        role: str(item?.role),
        sessionId: str(item?.sessionId),
        projectId: str(item?.projectId),
        inherited: Boolean(item?.inherited),
      })).filter((item) => item.sessionId)
      : [],
    context: normalizeContext(raw?.context),
    packages: Array.isArray(raw?.packages)
      ? raw.packages.slice(-30).map(normalizePackage).filter(Boolean)
      : [],
    ownership: Array.isArray(raw?.ownership)
      ? raw.ownership.slice(-60).map((item) => ({
        path: str(item?.path),
        owner: str(item?.owner),
        packageId: str(item?.packageId) || null,
      })).filter((item) => item.path && item.owner)
      : [],
    quote: raw?.quote && typeof raw.quote === 'object'
      ? {
        tokenBudget: num(raw.quote.tokenBudget),
        rounds: num(raw.quote.rounds),
        at: num(raw.quote.at) || null,
        by: str(raw.quote.by) || null,
      }
      : null,
    // 实耗是计数器，永远有对象（全零=还没开工），调用方不必判空。
    actual: normalizeActual(raw?.actual),
    budget: normalizeBudget(raw?.budget),
    // 时间盒：到点不自动延期，三选一交给客户。
    appetite: normalizeAppetite(raw?.appetite, shape, num(raw?.createdAt, Date.now())),
    // 优先级：立项时选，默认既不重要也不紧急（四象限左下角）。
    priority: normalizePriority(raw?.priority),
    manual: Array.isArray(raw?.manual) ? raw.manual.slice(-40).map(normalizeManualItem).filter(Boolean) : [],
    rejects: Array.isArray(raw?.rejects)
      ? raw.rejects.slice(-10).map((item) => ({
        round: num(item?.round),
        at: num(item?.at),
        by: str(item?.by) || null,
        mustFix: Array.isArray(item?.mustFix)
          ? item.mustFix.slice(0, 3).map((fix) => ({
            issue: str(fix?.issue),
            evidence: str(fix?.evidence),
          })).filter((fix) => fix.issue)
          : [],
      }))
      : [],
    delegation: raw?.delegation && typeof raw.delegation === 'object'
      ? {
        by: str(raw.delegation.by) || null,
        at: num(raw.delegation.at) || null,
        answerId: str(raw.delegation.answerId) || null,
      }
      : null,
    answers: Array.isArray(raw?.answers)
      ? raw.answers.slice(-30).map((item) => ({
        id: str(item?.id),
        questionId: str(item?.questionId),
        text: str(item?.text).slice(0, 4000),
        by: str(item?.by, 'secretary') || 'secretary',
        at: num(item?.at),
      })).filter((item) => item.id && item.text)
      : [],
    // 批量工单：line 编制下的一批条目（同构任务，逐条派、逐条收）。
    items: Array.isArray(raw?.items)
      ? raw.items.slice(-200).map((item, index) => ({
        id: str(item?.id, `i${index + 1}`),
        title: str(item?.title).slice(0, 160),
        detail: str(item?.detail).slice(0, 2000),
        state: PACKAGE_STATES.includes(str(item?.state)) ? str(item?.state) : 'queued',
        assignee: str(item?.assignee) || null,
        note: str(item?.note).slice(0, 500),
      })).filter((item) => item.title)
      : [],
    // v4 迁移时被新模型取代、但不想直接丢掉的老数据（只读展示用）。
    legacy: raw?.legacy && typeof raw.legacy === 'object' ? raw.legacy : null,
    baseline: raw?.baseline && typeof raw.baseline === 'object' ? raw.baseline : null,
    deliveryDiff: raw?.deliveryDiff && typeof raw.deliveryDiff === 'object' ? raw.deliveryDiff : null,
    vaultAccess: Boolean(raw?.vaultAccess),
    vaultEntry: raw?.vaultEntry && typeof raw.vaultEntry === 'object' ? raw.vaultEntry : null,
    executorStartedAt: num(raw?.executorStartedAt),
    autoMode: Boolean(raw?.autoMode),
    statusBeforeBlocked: str(raw?.statusBeforeBlocked) || null,
    latestVerdict: normalizeVerdict(raw?.latestVerdict),
    scope: normalizeScope(raw?.scope, raw?.description),
    workspaceMoves: Array.isArray(raw?.workspaceMoves)
      ? raw.workspaceMoves.slice(-20).map((item) => ({
        at: num(item?.at),
        by: str(item?.by, 'unknown') || 'unknown',
        from: str(item?.from),
        to: str(item?.to),
        reason: str(item?.reason),
      })).filter((item) => item.to)
      : [],
    checks: normalizeChecks(raw?.checks),
    verifications: normalizeVerifications(raw?.verifications),
    lastVerificationId: str(raw?.lastVerificationId) || null,
    reviewRound: num(raw?.reviewRound),
    retiredSessions: Array.isArray(raw?.retiredSessions)
      ? raw.retiredSessions.filter((id) => typeof id === 'string').slice(-50)
      : [],
    completedAt: num(raw?.completedAt) || null,
    questions: Array.isArray(raw?.questions) ? raw.questions.slice(-50) : [],
    history: Array.isArray(raw?.history) ? raw.history.slice(-80) : [],
    milestoneRevision: raw?.milestoneRevision && typeof raw.milestoneRevision === 'object'
      ? raw.milestoneRevision
      : null,
    createdAt: num(raw?.createdAt, Date.now()),
    updatedAt: num(raw?.updatedAt, Date.now()),
    milestones: milestones.map((m, index) => ({
      id: str(m?.id, `m${index + 1}`),
      title: str(m?.title, `里程碑 ${index + 1}`),
      weight: Math.max(1, num(m?.weight, 10)),
      done: Boolean(m?.done),
      doneAt: m?.doneAt ?? null,
    })),
    departments: {
      zhongshu: normalizeDept(departments.zhongshu),
      menxia: normalizeDept(departments.menxia),
      shangshu: normalizeDept(departments.shangshu),
      executor: normalizeDept(departments.executor),
    },
    briefs: Array.isArray(raw?.briefs) ? raw.briefs : [],
    // 「项目参考」：用户从会话里挑的片段，注入该项目的各个会话；附件：立项时拖进来的文件。
    references: Array.isArray(raw?.references)
      ? raw.references.slice(-30).map(normalizeReference).filter(Boolean)
      : [],
    attachments: Array.isArray(raw?.attachments)
      ? raw.attachments.slice(-40).map(normalizeAttachment).filter(Boolean)
      : [],
  };
}

export function normalize(raw) {
  const next = emptyState();
  next.seq = num(raw?.seq);
  if (raw?.settings && typeof raw.settings === 'object') {
    next.settings = {
      vaultPath: str(raw.settings.vaultPath, DEFAULT_VAULT_PATH),
      courtWorkspace: str(raw.settings.courtWorkspace, DEFAULT_COURT_WORKSPACE) || DEFAULT_COURT_WORKSPACE,
      secretarySessionId: str(raw.settings.secretarySessionId) || null,
      grantFullAccess: raw.settings.grantFullAccess === true,
      backupMode: raw.settings.backupMode === true,
      lastBackupSignature: str(raw.settings.lastBackupSignature) || '',
    };
  }
  if (raw?.projects && typeof raw.projects === 'object') {
    for (const [id, project] of Object.entries(raw.projects)) {
      next.projects[id] = normalizeProject(id, project);
    }
  }
  if (raw?.vault && typeof raw.vault === 'object') next.vault = raw.vault;
  if (raw?.kb) next.kb = normalizeKb(raw.kb);
  if (raw?.pendingJump && typeof raw.pendingJump === 'object') next.pendingJump = raw.pendingJump;
  return next;
}

export async function read() {
  if (state) return state;
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    state = normalize(JSON.parse(raw));
    readError = null;
  } catch (error) {
    // 只有「文件确实不存在」才算干净的新装；解析失败一律视为故障，禁止后续写入。
    readError = error?.code === 'ENOENT'
      ? 'ENOENT'
      : `状态文件损坏或不可读：${error?.message ?? error}`;
    console.warn('[court] 读取万象工阁状态失败：', readError);
    state = emptyState();
  }
  await attachKb(state);
  return state;
}

/**
 * 智库挂载：kb.json 存在就以它为准；不存在但有旧数据（历史上写在 court.json 里），
 * 就把旧数据留在内存并记为「待迁移」，下一次写盘顺手落到 kb.json。
 */
async function attachKb(base) {
  let fromFile = null;
  try {
    fromFile = JSON.parse(await fs.readFile(KB_FILE, 'utf8'));
  } catch {
    fromFile = null;
  }
  if (fromFile) {
    base.kb = normalizeKb(fromFile);
    kbSerialized = JSON.stringify(base.kb, null, 2);
    return;
  }
  const legacy = base.kb?.entries?.length ?? 0;
  base.kb = normalizeKb(base.kb ?? {});
  kbSerialized = legacy > 0 ? '' : JSON.stringify(base.kb, null, 2);
}

/** 智库单独落盘（内容没变就不写，避免 hits 之外的无意义写）。 */
async function persistKb(kb) {
  const serialized = JSON.stringify(normalizeKb(kb ?? {}), null, 2);
  if (serialized === kbSerialized) return;
  await fs.mkdir(STATE_DIR, { recursive: true });
  const tmp = `${KB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, serialized, 'utf8');
  await fs.rename(tmp, KB_FILE);
  kbSerialized = serialized;
}

/** 智库文件路径（面板/导出用）。 */
export function kbStateFilePath() {
  return KB_FILE;
}

/** 供路由/工具判断：读盘是否失败（失败时写操作会被拒绝）。 */
export function readProblem() {
  return readError;
}

/** 数一数磁盘上现在有几个项目；读不到就返回 0，不做任何写入。 */async function diskProjectCount() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && parsed.projects && typeof parsed.projects === 'object'
      ? Object.keys(parsed.projects).length
      : 0;
  } catch {
    return 0;
  }
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function persist(text, snapshot) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  // 空状态守卫：磁盘上明明有项目，这次却要写一个 0 项目的文件 → 拒绝。
  const projects = snapshot && snapshot.projects ? Object.keys(snapshot.projects).length : 0;
  if (projects === 0) {
    const existing = await diskProjectCount();
    if (existing > 0) {
      throw new Error(
        `[court] 空状态守卫：磁盘上有 ${existing} 个项目，本次写入会把它们全部清空，已拒绝。` +
        '请重启 DSH 让插件重新读盘；若状态文件真的损坏，先人工备份 court.json 再处理。',
      );
    }
  }
  // 留一份上一版：真出事时把 court.json.prev 改回 court.json 就能救。
  try {
    await fs.copyFile(STATE_FILE, `${STATE_FILE}.prev`);
  } catch {
    // 第一次写入时没有旧文件，忽略。
  }
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, STATE_FILE);
}

/** 串行写入：mutator 同步修改 state，随后落盘。 */
export function update(mutator) {
  const run = chain.then(async () => {
    let current = await read();
    // 文件损坏/读不了：拒绝写入，别拿空状态覆盖用户数据。
    if (readError && readError !== 'ENOENT') {
      throw new Error(`[court] 状态文件读取失败（${readError}），为防覆盖已拒绝写入；请先修复 ${STATE_FILE}`);
    }
    // 读盘时文件不存在，但写之前它出现了（典型：迁移还没建好 junction，DSH 先起来了）
    // → 重新读一次真身，别把已经存在的项目写没。
    if (readError === 'ENOENT' && await fileExists(STATE_FILE)) {
      state = null;
      readError = null;
      current = await read();
      if (readError && readError !== 'ENOENT') {
        throw new Error(`[court] 状态文件读取失败（${readError}），为防覆盖已拒绝写入；请先修复 ${STATE_FILE}`);
      }
    }
    const result = mutator(current);
    current.seq += 1;
    // court.json 不再背智库：项目状态一份、记忆一份，各自原子写。
    const mirror = { ...current };
    delete mirror.kb;
    await persist(JSON.stringify(mirror, null, 2), current);
    await persistKb(current.kb);
    return result;
  });
  chain = run.then(() => undefined, () => undefined);
  return run;
}

export function progressOf(project) {
  const total = project.milestones.reduce((sum, m) => sum + m.weight, 0);
  if (total <= 0) return 0;
  const done = project.milestones.reduce((sum, m) => sum + (m.done ? m.weight : 0), 0);
  return Math.round((done / total) * 100);
}

export function decorate(project) {
  return { ...project, progress: progressOf(project) };
}

export async function snapshot({ withBriefContent = false } = {}) {
  const current = await read();
  const projects = Object.values(current.projects)
    .map((project) => {
      const decorated = decorate(project);
      return {
        ...decorated,
        briefs: (project.briefs || []).map((brief) => (
          withBriefContent ? brief : briefMeta(brief)
        )),
        // 面板只展示最近几次结论；完整日志/尾部留在 court_get_project 的按需视图里。
        verifications: (project.verifications || []).slice(-3).map((verification) => ({
          ...verification,
          checks: (verification.checks || []).map((check) => ({
            id: check.id,
            command: check.command,
            exitCode: check.exitCode,
            durationMs: check.durationMs,
            ok: check.ok,
            timedOut: check.timedOut,
            logSha256: check.logSha256,
            error: check.error,
          })),
        })),
        // 面板不需要 80 条长 note；只留最近 10 条，避免 state 被历史撑爆。
        history: (project.history || []).slice(-10).map((item) => ({
          ...item,
          note: str(item.note).slice(0, 500),
        })),
        questions: (project.questions || []).slice(-10),
        workspaceMoves: (project.workspaceMoves || []).slice(-5),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    seq: current.seq,
    settings: current.settings,
    pendingJump: current.pendingJump,
    projects,
    vault: Object.values(current.vault).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0)),
    counts: {
      total: projects.length,
      active: projects.filter((p) => !['done', 'archived', 'paused'].includes(p.status)).length,
      paused: projects.filter((p) => p.status === 'paused').length,
      blocked: projects.filter((p) => p.status === 'blocked').length,
      waiting: projects.filter((p) => ['zhongshu', 'menxia', 'review'].includes(p.status)).length,
    },
  };
}

export function stateFilePath() {
  return STATE_FILE;
}

/** 同步读取已加载的内存状态（首轮 read() 之前为 null）。提示词段是同步的，只能走这里。 */
export function currentState() {
  return state;
}

export function setPendingJump(jump) {
  return update((current) => {
    current.pendingJump = jump;
  });
}
