/**
 * 万象工阁 agent 工具（按 preset 挂载）
 *
 * - 工具定义手写 schema（本包无法 import @deepseek-ai/*）
 * - 会话编排走宿主服务：sessionController.create / agents.get().followup()
 * - 所有项目状态经 store.js，与 HTTP 层共用同一份真源
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertBriefBudget, budgetOf } from './context.js';
import { roleLabel as brandRole } from './brand.js';
import { buildFork } from './fork.js';
import {
  KB_INJECT_MAX,
  KB_KIND_LABEL,
  KB_MAX_BODY,
  KB_MAX_ENTRIES,
  digestCandidates,
  kbStats,
  normalizeEntry,
  searchEntries,
  tokenize,
} from './kb.js';
import { auditChanges, describeAudit } from './ownership.js';
import { PACKAGE_STATES, nextPackage, validatePackages } from './packages.js';
import {
  DEFAULT_MILESTONES,
  ROLE_PRESET,
  briefMeta,
  decorate,
  makeId,
  normalizeProject,
  num,
  progressOf,
  quadrantOf,
  read,
  str,
  update,
} from './store.js';
import { performHandoff, onStatusChanged } from './handoff.js';
import { archiveBaseline, diffSnapshot, loadBaseline, saveBaseline, takeSnapshot, verifyWorkspace } from './snapshot.js';
import { searchVault } from './vault.js';
import {
  canConfirmScope,
  canDiff,
  canRebaseWorkspace,
  canSaveBrief,
  canSetChecks,
  canSetWorkspace,
  canSubmitVerdict,
  canUpdateStatus,
  canVerify,
  hasSeat,
  normalizeBriefKind,
  shapeOf,
  SHAPE_META,
  SHAPES,
} from './auth.js';
import { checkHint, lastVerification, normalizeChecks, preflightCheck, probeShell, runChecks, summarizeChecks } from './checks.js';
import { gitDiff } from './diff.js';

export const inject = ['tools'];

/** 从调用者会话 id 反查它在项目里的身份；认不出来就返回 null。 */
function roleOf(state, project, exec) {
  const caller = exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '';
  if (!caller) return { role: null, caller: '' };
  if (state.settings.secretarySessionId === caller) return { role: 'secretary', caller };
  for (const [role, dept] of Object.entries(project.departments)) {
    if (dept.sessionId === caller) return { role, caller };
  }
  return { role: null, caller };
}

/**
 * 公司级工具（知识库）没有「当前项目」，只按会话反查身份：
 * 秘书会话 → secretary，其它会话遍历所有项目找它挂在哪个席位上。
 */
function roleOfCaller(state, exec) {
  const caller = exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '';
  if (!caller) return null;
  if (state.settings.secretarySessionId === caller) return 'secretary';
  for (const project of Object.values(state.projects)) {
    for (const [role, dept] of Object.entries(project.departments)) {
      if (dept.sessionId === caller) return role;
    }
    for (const retired of project.retiredSessions || []) {
      if (retired.sessionId === caller) return retired.role || null;
    }
  }
  return 'user';
}

/**
 * 角色显示名：内部 id 不变，对外是公司里的岗位。
 * 同一席位在轻量组里叫「交付工程师」，在项目组里叫「项目经理」，见 brand.js。
 */
const ROLE_LABEL = {
  zhongshu: brandRole('zhongshu'),
  menxia: brandRole('menxia'),
  shangshu: brandRole('shangshu'),
  executor: brandRole('executor'),
};

const HANDOFF_STATUS = {
  zhongshu: 'zhongshu',
  menxia: 'menxia',
  shangshu: 'shangshu',
  executor: 'executing',
};

const DEFAULT_TASK = {
  zhongshu: '请据此修订文书，处理完毕后再次 court_handoff 提交评审（轻量组直接提交项目经理）。',
  menxia: '请先 court_submit_verdict：pass 则 court_handoff 到 shangshu，reject 则带最多 3 条 mustFix 并 court_handoff 回 zhongshu。',
  shangshu: '请确定工作区（必要时先问用户要现成目录），用 court_set_workspace 落库；项目组 court_handoff 到 executor 派活，轻量组由你自己开工（court_handoff 到 executing）。开工前客户要先签范围（court_confirm_scope）。',
  executor: '请按工单执行，完成后用 court_update_project 勾掉对应里程碑，并简述交付物。',
};

// ---------------------------------------------------------------------------
// 服务访问
// ---------------------------------------------------------------------------

function service(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

function samePath(a, b) {
  const norm = (value) => String(value ?? '').replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function ensureWorkspace(ctx, dirPath, title) {
  const registry = service(ctx, 'workspaceRegistry');
  if (!registry) return null;
  const existing = registry.list().find((entry) => samePath(entry.path, dirPath));
  if (existing) return existing;
  try {
    return await registry.create(dirPath, title);
  } catch {
    return registry.list().find((entry) => samePath(entry.path, dirPath)) ?? null;
  }
}

async function openCourtSession(ctx, { preset, dirPath, title }) {
  const controller = service(ctx, 'sessionController');
  if (!controller) throw new Error('sessionController 未挂载，无法开新会话');

  await ensureDir(dirPath);
  const workspace = await ensureWorkspace(ctx, dirPath, title);

  const request = workspace
    ? { workspaceId: workspace.id, agentPreset: preset }
    : { cwd: dirPath, agentPreset: preset };

  const created = await controller.create(request);
  return created.sessionId;
}

async function promptSession(ctx, sessionId, text) {
  const agents = service(ctx, 'agents');
  const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : undefined;
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'court-handoff' },
  };
  if (agent && typeof agent.followup === 'function') {
    agent.followup(message);
    return;
  }
  const controller = service(ctx, 'sessionController');
  if (!controller || typeof controller.prompt !== 'function') {
    throw new Error('找不到可用的会话通道，无法投递文书');
  }
  const abort = new AbortController();
  await controller.prompt({
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
    requestId: `court-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  }, abort.signal);
}

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

const VIEWS = new Set(['index', 'work', 'full']);

function briefIndex(brief) {
  return { ...briefMeta(brief), has_content: false };
}

function briefView(brief) {
  return { ...briefMeta(brief), has_content: true, content: str(brief.content) };
}

/**
 * 读项目的视图：
 * - index：只给索引（默认），正文按需 court_read_brief；
 * - work：按角色只带本次需要的正文；
 * - full：显式全量（慎用，容易 spill）。
 */
function briefsForView(project, role, view, ids = []) {
  if (view === 'full') return project.briefs.map(briefView);
  if (view === 'index') return project.briefs.map(briefIndex);

  const wanted = new Set((Array.isArray(ids) ? ids : []).map((id) => str(id)).filter(Boolean));
  const latest = (kind) => [...project.briefs].reverse().find((brief) => brief.kind === kind);
  const plan = project.approvedBriefId
    ? project.briefs.find((brief) => brief.id === project.approvedBriefId)
    : latest('plan');
  if (plan) wanted.add(plan.id);

  if (role === 'menxia') {
    const report = latest('report');
    if (report) wanted.add(report.id);
    const verdict = latest('verdict');
    if (verdict) wanted.add(verdict.id);
  }
  if (role === 'zhongshu') {
    for (const brief of project.briefs.filter((item) => item.kind === 'brief').slice(-2)) {
      wanted.add(brief.id);
    }
  }
  if (role === 'shangshu') {
    const review = latest('review') ?? latest('verdict');
    if (review) wanted.add(review.id);
  }
  if (role === 'executor') {
    const brief = latest('brief');
    if (brief) wanted.add(brief.id);
  }

  const withContent = (brief) => (
    str(brief.content).length <= 24000 ? briefView(brief) : briefIndex(brief)
  );
  return project.briefs.map((brief) => (wanted.has(brief.id) ? withContent(brief) : briefIndex(brief)));
}

function checkView(check) {
  return {
    id: check.id,
    command: check.command,
    shell: check.shell || 'auto',
    timeout_ms: check.timeoutMs,
  };
}

function latestBrief(project, kind) {
  return [...project.briefs].reverse().find((brief) => brief.kind === kind) ?? null;
}

function verificationView(verification, detailed = false) {
  if (!verification) {
    return { id: '', at: 0, by: '', ok: false, skipped: true, checks: [] };
  }
  return {
    id: verification.id,
    at: verification.at,
    by: verification.by,
    ok: Boolean(verification.ok),
    skipped: Boolean(verification.skipped),
    checks: summarizeChecks(verification).map((check) => (
      detailed ? check : { ...check, stdout_tail: '', stderr_tail: '' }
    )),
  };
}

const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: 'check id。' },
    command: { type: 'string', required: true, description: '要执行的命令。' },
    shell: { type: 'string', required: true, description: 'auto/cmd/pwsh/powershell/bash。' },
    timeout_ms: { type: 'integer', required: true, description: '超时（毫秒）。' },
  },
};

const CHECK_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: 'check id。' },
    command: { type: 'string', required: true, description: '执行的命令。' },
    shell: { type: 'string', required: true, description: '实际使用的 shell。' },
    exit_code: { type: 'integer', required: true, description: '退出码；-1 表示启动失败/超时。' },
    duration_ms: { type: 'integer', required: true, description: '耗时（毫秒）。' },
    ok: { type: 'boolean', required: true, description: '是否通过。' },
    timed_out: { type: 'boolean', required: true, description: '是否超时。' },
    stdout_tail: { type: 'string', required: true, description: 'stdout 尾部（最多 4K 字符）。' },
    stderr_tail: { type: 'string', required: true, description: 'stderr 尾部（最多 4K 字符）。' },
    log_sha256: { type: 'string', required: true, description: '完整输出日志的 sha256。' },
    log_path: { type: 'string', required: true, description: '完整日志路径。' },
  },
};

const VERIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: '验证 id；空串表示没跑 checks。' },
    at: { type: 'integer', required: true, description: '时间戳。' },
    by: { type: 'string', required: true, description: '谁发起的。' },
    ok: { type: 'boolean', required: true, description: '全部 check 是否通过。' },
    skipped: { type: 'boolean', required: true, description: '是否因为没有登记 checks 而跳过。' },
    checks: {
      type: 'array',
      required: true,
      description: '逐条 check 结果。',
      items: CHECK_RESULT_SCHEMA,
    },
  },
};

function projectView(project, { withBriefs }) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    progress: progressOf(project),
    rounds: project.rounds,
    blockedReason: project.blockedReason,
    workspace: project.workspace ? project.workspace.path : '',
    milestones: project.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      weight: m.weight,
      done: m.done,
    })),
    sessions: {
      zhongshu: project.departments.zhongshu.sessionId ?? '',
      menxia: project.departments.menxia.sessionId ?? '',
      shangshu: project.departments.shangshu.sessionId ?? '',
      executor: project.departments.executor.sessionId ?? '',
    },
    briefs: withBriefs ? project.briefs.map(briefView) : undefined,
  };
}

function handoffText(project, brief, from, to, note) {
  const lines = [
    '【万象工阁 · 移交】',
    `项目：${project.name}（${project.id}）`,
    `来自：${ROLE_LABEL[from] ?? from}`,
    `移交至：${ROLE_LABEL[to] ?? to}`,
    `项目状态：${project.status}`,
    project.rounds > 0 ? `驳回轮次：${project.rounds}` : '',
    '',
  ];
  if (brief) {
    lines.push(`—— 文书（${brief.kind}｜${brief.title}）——`, brief.content, '');
  }
  lines.push('—— 你的任务 ——', note || DEFAULT_TASK[to] || '请按项目状态推进。', '');
  lines.push(
    '可用万象工阁工具：court_get_project（读完整项目）、court_save_brief（写文书）、',
    'court_handoff（移交）、court_set_workspace（定工作区）、court_update_project（改状态/里程碑）。',
  );
  return lines.filter((line) => line !== '').join('\n');
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------

function toRawSchema(node) {
  const out = {};
  out.type = node.type;
  if (node.items !== undefined) out.items = toRawSchema(node.items);
  if (node.type === 'object') {
    out.additionalProperties = node.additionalProperties === true;
    const properties = {};
    const required = [];
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      if (value.required === true) required.push(key);
      properties[key] = toRawSchema(value);
    }
    out.properties = properties;
    if (required.length > 0) out.required = required;
  }
  if (node.description !== undefined) out.description = node.description;
  return out;
}

export function apply(ctx) {
  const makeTool = (name, description, parameters, outputSchema, execute) => ({
    name,
    description,
    parameters: toRawSchema({ type: 'object', additionalProperties: false, properties: parameters }),
    output: {
      schema: toRawSchema(outputSchema),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: (args, exec) => Promise.resolve(execute(args ?? {}, exec)),
  });

  // -- 列表 ---------------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_list_projects',
    '列出项目看板里的项目（按最近更新排序）。用于了解手上有哪些项目、卡在哪个阶段。',
    {
      status: { type: 'string', description: '只看某个状态：draft/zhongshu/menxia/shangshu/executing/review/done/blocked。' },
      limit: { type: 'integer', description: '最多返回几条，默认 20。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        projects: {
          type: 'array',
          required: true,
          description: '项目摘要列表。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true, description: '项目 id。' },
              name: { type: 'string', required: true, description: '项目名。' },
              status: { type: 'string', required: true, description: '当前阶段。' },
              mode: { type: 'string', required: true, description: 'full/lite（v3 遗留，等于 crew/squad）。' },
              shape: { type: 'string', required: true, description: 'squad/crew/line。' },
              progress: { type: 'integer', required: true, description: '进度百分比。' },
              rounds: { type: 'integer', required: true, description: '驳回轮次。' },
              blocked_reason: { type: 'string', description: '阻塞原因。' },
              workspace: { type: 'string', required: true, description: '项目工作区路径；空串表示未定。' },
              open_questions: { type: 'integer', required: true, description: '挂起待用户回答的奏疏数。' },
              next_action: { type: 'string', required: true, description: '一句话下一步（谁该动）。' },
              last_update: { type: 'integer', required: true, description: '最近更新时间戳。' },
              session_count: { type: 'integer', required: true, description: '当前/历史会话数。' },
            },
          },
        },
      },
    },
    async (args) => {
      const state = await read();
      const limit = Math.min(100, Math.max(1, num(args.limit, 20)));
      const wanted = str(args.status);
      const projects = Object.values(state.projects)
        .map(decorate)
        .filter((project) => !wanted || project.status === wanted)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map((project) => {
          const openQuestions = (project.questions || []).filter((question) => question.status === 'open').length;
          const sessions = new Set([
            ...Object.values(project.departments || {}).map((dept) => dept && dept.sessionId),
            ...(project.retiredSessions || []),
          ].filter(Boolean));
          const nextAction = project.status === 'blocked'
            ? `等用户解阻：${project.blockedReason || '原因未记录'}`
            : openQuestions > 0
              ? `等用户批 ${openQuestions} 条奏疏`
              : project.status === 'review'
                ? '等最终裁决（评审/用户）'
                : project.status === 'done'
                  ? '可结项归档，或收进知识库'
                  : project.status === 'draft'
                    ? '立项后定工作区，交架构组'
                    : project.status === 'executing'
                      ? '工程师施工中'
                      : '看当前省节点，必要时催办';
          return {
            id: project.id,
            name: project.name,
            status: project.status,
            shape: project.shape,
            mode: project.mode,
            progress: project.progress,
            rounds: project.rounds,
            blocked_reason: project.blockedReason ?? '',
            workspace: project.workspace && project.workspace.path ? project.workspace.path : '',
            open_questions: openQuestions,
            next_action: nextAction,
            last_update: project.updatedAt || 0,
            session_count: sessions.size,
          };
        });
      return { projects };
    },
  ));

  // -- 秘书直达 -----------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_send_message',
    '秘书专用：直接给某个项目里的某个省/工程师发一条消息（催办、补充信息、要求汇报）。目标会话必须已经存在。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      role: { type: 'string', required: true, description: 'zhongshu / menxia / shangshu / executor / secretary。' },
      text: { type: 'string', required: true, description: '要发的话，一句话说清。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        sent: { type: 'boolean', required: true, description: '是否已投递。' },
        sessionId: { type: 'string', required: true, description: '目标会话 id。' },
      },
    },
    async (args, exec) => {
      const state = await read();
      const project = state.projects[str(args.projectId)];
      if (!project) throw new Error('项目不存在');
      const { role: callerRole } = roleOf(state, project, exec);
      if (callerRole !== 'secretary') throw new Error('只有秘书可以直达各省');
      const role = str(args.role);
      const target = role === 'secretary'
        ? state.settings.secretarySessionId
        : (project.departments[role] && project.departments[role].sessionId);
      if (!target) throw new Error(`目标角色 ${role} 还没有会话；先 court_handoff 或等它启动`);
      const text = str(args.text).trim();
      if (!text) throw new Error('消息不能为空');
      await promptSession(ctx, target, `【秘书直达】\n${text}`);
      return { sent: true, sessionId: target };
    },
  ));

  // -- 详情 ---------------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_get_project',
    '读取一个项目。默认 view=index 只返回文书索引，正文用 court_read_brief 按需读；' +
      'view=work 按角色只带必要正文（方案/本次 report/verdict 等）；view=full 才全量。移交/审阅前先读它。',
    {
      projectId: { type: 'string', required: true, description: '项目 id（p_ 开头）。' },
      view: {
        type: 'string',
        description: 'index（默认，只给索引）/ work（按角色给必要正文）/ full（全量，慎用）。',
      },
      briefIds: {
        type: 'array',
        description: 'view=work 时额外指定要读的文书 id。',
        items: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        project: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '项目 id。' },
            name: { type: 'string', required: true, description: '项目名。' },
            description: { type: 'string', required: true, description: '需求描述。' },
            status: { type: 'string', required: true, description: '当前阶段。' },
            mode: { type: 'string', required: true, description: 'full/lite。' },
            latest_verdict: {
              type: 'object',
              required: true,
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true, description: 'verdict 文书 id；空串表示没有。' },
                decision: { type: 'string', required: true, description: 'pass/reject/空串。' },
                phase: { type: 'string', required: true, description: 'menxia/review/空串。' },
                must_fix_count: { type: 'integer', required: true, description: '阻塞项数量。' },
                note_count: { type: 'integer', required: true, description: '非阻塞备注数量。' },
                at: { type: 'integer', required: true, description: '时间戳。' },
              },
            },
            scope: {
              type: 'object',
              required: true,
              additionalProperties: false,
              properties: {
                original: { type: 'string', required: true, description: '最初需求。' },
                approved_plan_id: { type: 'string', required: true, description: '已批准方案 id。' },
                drift_reason: { type: 'string', required: true, description: 'material 变更原因；空串表示无。' },
                drift_at: { type: 'integer', required: true, description: '漂移时间戳。' },
                confirmed_at: { type: 'integer', required: true, description: '用户/秘书确认时间戳。' },
              },
            },
            rounds: { type: 'integer', required: true, description: '驳回轮次。' },
            progress: { type: 'integer', required: true, description: '进度百分比。' },
            blocked_reason: { type: 'string', required: true, description: '阻塞原因，空串表示无。' },
            workspace: { type: 'string', required: true, description: '工作区路径。' },
            sessions: {
              type: 'object',
              required: true,
              additionalProperties: false,
              description: '各省会话 id，空串表示还没开。',
              properties: {
                zhongshu: { type: 'string', required: true, description: '架构组的会话 id。' },
                menxia: { type: 'string', required: true, description: '评审的会话 id。' },
                shangshu: { type: 'string', required: true, description: '项目管理的会话 id。' },
                executor: { type: 'string', required: true, description: '工程师的会话 id。' },
              },
            },
            history: {
              type: 'array',
              required: true,
              description: '状态变更历史：谁、何时、从哪到哪、引用哪份 report。判断顺序是否合规看这里。',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  at: { type: 'integer', required: true, description: '时间戳（毫秒）。' },
                  from: { type: 'string', required: true, description: '原状态。' },
                  to: { type: 'string', required: true, description: '新状态。' },
                  by: { type: 'string', required: true, description: '谁改的（zhongshu/menxia/shangshu/executor/secretary/user）。' },
                  note: { type: 'string', required: true, description: '备注。' },
                  report_id: { type: 'string', required: true, description: '置 review 时钉住的 report 文书 id；空串表示当时没有。' },
                },
              },
            },
            milestones: {
              type: 'array',
              required: true,
              description: '里程碑。',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true, description: '里程碑 id。' },
                  title: { type: 'string', required: true, description: '标题。' },
                  weight: { type: 'integer', required: true, description: '权重。' },
                  done: { type: 'boolean', required: true, description: '是否完成。' },
                },
              },
            },
            briefs: {
              type: 'array',
              required: true,
              description: '文书列表。index 视图只有索引；work/full 视图里相关文书带正文。',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true, description: '文书 id。' },
                  kind: { type: 'string', required: true, description: '类型。' },
                  title: { type: 'string', required: true, description: '标题。' },
                  author: { type: 'string', required: true, description: '作者角色。' },
                  summary: { type: 'string', required: true, description: '一句话摘要。' },
                  createdAt: { type: 'integer', required: true, description: '创建时间戳（毫秒）。' },
                  chars: { type: 'integer', required: true, description: '正文字符数。' },
                  version: { type: 'integer', required: true, description: '文书版本号。' },
                  has_content: { type: 'boolean', required: true, description: '是否带正文。' },
                  content: { type: 'string', description: '正文；has_content=false 时省略。' },
                },
              },
            },
            references: {
              type: 'array',
              required: true,
              description: '用户手工加进「项目参考」的会话片段（预览）；正文看 reference_text。',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true, description: '参考 id。' },
                  from: { type: 'string', required: true, description: '来源会话名。' },
                  kind: { type: 'string', required: true, description: 'session（整段）/ messages（几条）。' },
                  at: { type: 'integer', required: true, description: '加入时间戳。' },
                  chars: { type: 'integer', required: true, description: '总字符数。' },
                  preview: { type: 'string', required: true, description: '首条预览（前 200 字）。' },
                },
              },
            },
            reference_text: {
              type: 'array',
              description: 'view=work/full 时给出参考正文；index 视图省略。',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true, description: '参考 id。' },
                  from: { type: 'string', required: true, description: '来源会话名。' },
                  items: {
                    type: 'array',
                    required: true,
                    description: '逐条消息。',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        role: { type: 'string', required: true, description: 'user/assistant。' },
                        text: { type: 'string', required: true, description: '正文。' },
                      },
                    },
                  },
                },
              },
            },
            attachments: {
              type: 'array',
              required: true,
              description: '立项时拖进来的附件（本地路径，可直接用 read 工具读）。',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true, description: '附件 id。' },
                  name: { type: 'string', required: true, description: '文件名。' },
                  bytes: { type: 'integer', required: true, description: '字节数。' },
                  path: { type: 'string', required: true, description: '宿主本地路径。' },
                },
              },
            },
            checks: {
              type: 'array',
              required: true,
              description: '登记过的验收命令。',
              items: CHECK_SCHEMA,
            },
            last_verification: {
              ...VERIFICATION_SCHEMA,
              required: true,
              description: '最近一次验收结果；没跑过时 id 为空。',
            },
          },
        },
      },
    },
    async (args, exec) => {
      const state = await read();
      const project = state.projects[str(args.projectId)];
      if (!project) throw new Error(`项目不存在：${str(args.projectId)}`);
      const { role } = roleOf(state, project, exec);
      const view = VIEWS.has(str(args.view)) ? str(args.view) : 'index';
      const briefs = briefsForView(project, role, view, Array.isArray(args.briefIds) ? args.briefIds : []);
      const historyLimit = view === 'full' ? 80 : 10;
      const historyNoteLimit = view === 'full' ? 4000 : 500;
      // 只输出 schema 声明过的字段：多带一个键就会被 additionalProperties:false 拒掉
      return {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          mode: project.mode,
          latest_verdict: {
            id: project.latestVerdict?.id ?? '',
            decision: project.latestVerdict?.decision ?? '',
            phase: project.latestVerdict?.phase ?? '',
            must_fix_count: project.latestVerdict?.mustFix?.length ?? 0,
            note_count: project.latestVerdict?.notes?.length ?? 0,
            at: project.latestVerdict?.at ?? 0,
          },
          scope: {
            original: project.scope?.original ?? project.description,
            approved_plan_id: project.scope?.approvedPlanId ?? '',
            drift_reason: project.scope?.drift?.reason ?? '',
            drift_at: project.scope?.drift?.at ?? 0,
            confirmed_at: project.scope?.confirmedAt ?? 0,
          },
          progress: progressOf(project),
          rounds: project.rounds,
          blocked_reason: project.blockedReason ?? '',
          workspace: project.workspace ? project.workspace.path : '',
          sessions: {
            zhongshu: project.departments.zhongshu.sessionId ?? '',
            menxia: project.departments.menxia.sessionId ?? '',
            shangshu: project.departments.shangshu.sessionId ?? '',
            executor: project.departments.executor.sessionId ?? '',
          },
          milestones: project.milestones.map((m) => ({
            id: m.id,
            title: m.title,
            weight: m.weight,
            done: m.done,
          })),
          history: (project.history || []).slice(-historyLimit).map((item) => ({
            at: num(item.at, 0),
            from: str(item.from),
            to: str(item.to),
            by: str(item.by, 'unknown') || 'unknown',
            note: str(item.note).slice(0, historyNoteLimit),
            report_id: str(item.reportId),
          })),
          briefs,
          references: (project.references || []).map((reference) => ({
            id: reference.id,
            from: reference.sessionLabel,
            kind: reference.kind,
            at: reference.createdAt,
            chars: reference.items.reduce((sum, item) => sum + item.text.length, 0),
            preview: str(reference.items[0] && reference.items[0].text).slice(0, 200),
          })),
          ...view === 'index' ? {} : {
            reference_text: (project.references || []).map((reference) => ({
              id: reference.id,
              from: reference.sessionLabel,
              items: reference.items.slice(0, 40).map((item) => ({
                role: item.role,
                text: item.text.slice(0, 2000),
              })),
            })),
          },
          attachments: (project.attachments || []).map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            bytes: attachment.bytes,
            path: attachment.path,
          })),
          checks: project.checks.map(checkView),
          last_verification: verificationView(lastVerification(project), view !== 'index'),
        },
      };
    },
  ));

  // -- 读单份文书 ---------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_read_brief',
    '按需读取一份文书的正文（支持分块）。默认 court_get_project 只给索引，要全文时用它。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      briefId: { type: 'string', required: true, description: '文书 id（b_ 开头）。' },
      offset: { type: 'integer', description: '起始字符偏移，默认 0。' },
      maxChars: { type: 'integer', description: '本次最多返回多少字符，默认 8000，上限 20000。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        brief: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '文书 id。' },
            kind: { type: 'string', required: true, description: '类型。' },
            title: { type: 'string', required: true, description: '标题。' },
            version: { type: 'integer', required: true, description: '版本号。' },
            total_chars: { type: 'integer', required: true, description: '正文总字符数。' },
            offset: { type: 'integer', required: true, description: '本次起始偏移。' },
            next_offset: { type: 'integer', required: true, description: '下次起点；-1 表示已读完。' },
            has_more: { type: 'boolean', required: true, description: '是否还有后续内容。' },
            content: { type: 'string', required: true, description: '本次返回的正文。' },
          },
        },
      },
    },
    async (args) => {
      const state = await read();
      const project = state.projects[str(args.projectId)];
      if (!project) throw new Error(`项目不存在：${str(args.projectId)}`);
      const brief = project.briefs.find((item) => item.id === str(args.briefId));
      if (!brief) throw new Error(`文书不存在：${str(args.briefId)}`);
      const text = str(brief.content);
      const total = text.length;
      const offset = Math.min(total, Math.max(0, Math.trunc(num(args.offset, 0))));
      const maxChars = Math.min(20000, Math.max(200, Math.trunc(num(args.maxChars, 8000))));
      const content = text.slice(offset, offset + maxChars);
      const nextOffset = offset + content.length < total ? offset + content.length : -1;
      return {
        brief: {
          id: brief.id,
          kind: str(brief.kind, 'brief') || 'brief',
          title: str(brief.title, '未命名文书'),
          version: num(brief.version, 1),
          total_chars: total,
          offset,
          next_offset: nextOffset,
          has_more: nextOffset >= 0,
          content,
        },
      };
    },
  ));

  // -- 立项 ---------------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_create_project',
    '立项：在项目看板建一个新项目。秘书用它把用户的一句话需求变成项目，之后交给架构组。',
    {
      name: { type: 'string', required: true, description: '项目名。' },
      description: { type: 'string', description: '需求描述。' },
      shape: {
        type: 'string',
        description: '编制：squad（轻量岗位，架构+交付自己干，默认）/ crew（完整岗位，多一道评审+独立工程师）/ line（批量工单，一次派多条）。',
      },
      mode: {
        type: 'string',
        description: 'v3 遗留字段：lite→squad，full→crew。优先用 shape。',
      },
      vaultAccess: {
        type: 'boolean',
        description: '是否允许项目里的 Agent 浏览知识库，默认 true。',
      },
      important: {
        type: 'boolean',
        description: '是否重要（影响长期目标/交付质量）。默认 false。',
      },
      urgent: {
        type: 'boolean',
        description: '是否紧急（有硬期限/别人在等）。默认 false。两者都 false = 四象限左下角，不插队。',
      },
      milestones: {
        type: 'array',
        description: '自定义里程碑；省略则用默认五项。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true, description: '标题。' },
            weight: { type: 'integer', required: true, description: '权重。' },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        project: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '项目 id。' },
            name: { type: 'string', required: true, description: '项目名。' },
            status: { type: 'string', required: true, description: '状态。' },
            mode: { type: 'string', required: true, description: 'full/lite。' },
            priority: {
              type: 'string',
              required: true,
              description: '四象限：important-urgent / important-not-urgent / urgent-not-important / neither。',
            },
          },
        },
      },
    },
    async (args, exec) => {
      const name = str(args.name).trim();
      if (!name) throw new Error('项目名不能为空');
      const state = await read();
      const caller = exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '';
      const belongsToDepartment = Object.values(state.projects).some((project) => (
        Object.values(project.departments).some((dept) => dept.sessionId === caller)
      ));
      if (caller && belongsToDepartment) {
        throw new Error('只有接单台可以立项；其他角色请把需求交给秘书');
      }
      const now = Date.now();
      const id = makeId('p');
      const milestones = Array.isArray(args.milestones) && args.milestones.length > 0
        ? args.milestones
        : DEFAULT_MILESTONES;
      const project = normalizeProject(id, {
        name,
        description: str(args.description),
        status: 'draft',
        shape: SHAPES.includes(str(args.shape))
          ? str(args.shape)
          : (str(args.mode) === 'full' ? 'crew' : 'squad'),
        vaultAccess: args.vaultAccess !== false,
        priority: { important: args.important === true, urgent: args.urgent === true },
        createdAt: now,
        updatedAt: now,
        milestones: milestones.map((m, index) => ({
          id: `m${index + 1}`,
          title: str(m?.title, `里程碑 ${index + 1}`),
          weight: Math.max(1, num(m?.weight, 10)),
        })),
      });
      await update((state) => {
        state.projects[id] = project;
      });
      return {
        project: {
          id,
          name,
          status: project.status,
          mode: project.mode,
          shape: project.shape,
          priority: quadrantOf(project),
        },
      };
    },
  ));

  // -- 承接：同一仓库的后续项目，别让架构师从零摸底 -------------------------
  ctx.tools.register(makeTool(
    'court_fork_project',
    '承接立项：在同一工作区（或同族仓库）开一个后续项目，继承上一个项目的上下文索引、文件归属、'
    + '验收命令，并复用它的岗位会话——架构师不会从零重新读一遍代码，这一步省掉的主要就是这段 token。'
    + '只在"同一件事的下一轮"或"同一个代码库的新需求"时用；全新需求请用 court_create_project。',
    {
      fromId: { type: 'string', required: true, description: '被承接的项目 id。' },
      name: { type: 'string', required: true, description: '新项目名。' },
      description: { type: 'string', description: '这一轮要做什么。' },
      shape: { type: 'string', description: '编制；省略则沿用上一个项目。' },
      reuseSessions: { type: 'boolean', description: '是否复用上一个项目的会话，默认 true。' },
      inheritChecks: { type: 'boolean', description: '是否继承已预跑过的验收命令，默认 true。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        project: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '新项目 id。' },
            name: { type: 'string', required: true, description: '项目名。' },
            shape: { type: 'string', required: true, description: '编制。' },
            inherited: { type: 'string', required: true, description: '继承了哪些东西（一句话）。' },
            reusedSessions: { type: 'integer', required: true, description: '复用了几个会话。' },
          },
        },
      },
    },
    async (args, exec) => {
      const fromId = str(args.fromId).trim();
      const name = str(args.name).trim();
      if (!fromId) throw new Error('fromId 不能为空');
      if (!name) throw new Error('项目名不能为空');
      const state = await read();
      const parent = state.projects[fromId];
      if (!parent) throw new Error(`被承接的项目不存在：${fromId}`);
      const caller = exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '';
      const parentDept = Object.values(parent.departments || {})
        .some((dept) => dept && dept.sessionId === caller);
      if (caller && parentDept) {
        throw new Error('承接立项由秘书或用户发起；省内角色请把需求交回秘书');
      }

      const id = makeId('p');
      const { project, inherited, reusedSessions } = buildFork(parent, {
        id,
        name,
        description: args.description,
        shape: args.shape,
        reuseSessions: args.reuseSessions,
        inheritChecks: args.inheritChecks,
      });
      await update((next) => {
        next.projects[id] = project;
      });
      return {
        project: { id, name, shape: project.shape, inherited, reusedSessions },
      };
    },
  ));

  // -- 文书 ---------------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_save_brief',
    '把一份文书存进项目（需求稿、方案、审核意见、驳回理由、交付说明）。文书会随移交一起送达下一省。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      kind: { type: 'string', description: '类型：contract（契约/需求确认，≤3000）/ plan（方案，≤12000）/ architecture（架构，≤8000）/ quote（报价，≤1500）/ package（工单，≤2000）/ report（交付说明，≤6000）/ acceptance（验收，≤3000）/ change（变更，≤2000）/ closing（结项，≤3000）/ brief（其他，≤6000）。认不出的类型会报错，不会静默降级。审核结论请用 court_submit_verdict。' },
      title: { type: 'string', required: true, description: '文书标题。' },
      content: { type: 'string', required: true, description: '正文（Markdown）。' },
      summary: { type: 'string', description: '一句话摘要，列表里显示这个。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        brief: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '文书 id。' },
            title: { type: 'string', required: true, description: '标题。' },
            kind: { type: 'string', required: true, description: '类型。' },
            version: { type: 'integer', required: true, description: '版本号。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const content = str(args.content);
      if (!content.trim()) throw new Error('文书正文不能为空');
      if (content.length > 200000) throw new Error('文书正文超过 200000 字符；请拆成多份文书');
      const kind = normalizeBriefKind(args.kind);
      if (kind === 'verdict' || kind === 'review') {
        throw new Error('审核结论请用 court_submit_verdict（必须/备注分开，最多 3 条 must-fix），不要用 court_save_brief');
      }
      // 硬预算：超了直接报错，让作者去打补丁 / 拆文书。静默截断会让审的人以为看全了。
      assertBriefBudget(kind, content);
      const preState = await read();
      const preProject = preState.projects[projectId];
      const { role: authorRole } = preProject ? roleOf(preState, preProject, exec) : { role: null };
      if (!canSaveBrief(authorRole, kind)) {
        throw new Error(`角色 ${authorRole || 'unknown'} 不能写 ${kind} 文书`);
      }
      const brief = {
        id: makeId('b'),
        kind,
        title: str(args.title, '未命名文书'),
        summary: str(args.summary).trim()
          || (content.split('\n').map((line) => line.trim()).find(Boolean) ?? '').slice(0, 80),
        content,
        author: authorRole || 'unknown',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
        revisions: [],
      };
      await update((state) => {
        const project = state.projects[projectId];
        if (!project) throw new Error(`项目不存在：${projectId}`);
        project.briefs.push(brief);
        if (kind === 'plan' || kind === 'report') project.latestVerdict = null;
        if (kind === 'plan' && (project.scope.approvedPlanId || project.scope.approvedAt)) {
          project.scope.drift = {
            at: Date.now(),
            by: authorRole || 'unknown',
            reason: '提交了新的完整方案（可能改变已批准范围）',
            fromPlanId: project.scope.approvedPlanId || '',
            toPlanId: brief.id,
          };
          project.scope.confirmedAt = 0;
          project.scope.confirmedBy = '';
        }
        project.updatedAt = Date.now();
      });
      return { brief: { id: brief.id, title: brief.title, kind: brief.kind, version: 1 } };
    },
  ));

  // -- 项目上下文：跨省传递的索引，不是正文 ---------------------------------
  ctx.tools.register(makeTool(
    'court_set_context',
    '写项目上下文：结构地图 / 技术栈 / 约定 / 坑 / 常改文件。这些会作为「索引」随每次移交投给对方（≤2000 字符），'
    + '所以只写结论，不要贴代码。未提供的字段保持原样；多次调用可增量补充。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      map: { type: 'string', description: '结构地图：模块→目录，一行一个（≤2000 字符）。' },
      stack: { type: 'string', description: '技术栈：语言/框架/构建/运行方式（≤1000 字符）。' },
      conventions: { type: 'string', description: '约定：命名、分层、错误处理、提交规范（≤2000 字符）。' },
      gotchas: { type: 'string', description: '坑：已知陷阱、不可动的文件、历史事故（≤2000 字符）。' },
      topPaths: {
        type: 'array',
        description: '常改文件（最多 40 条，相对路径）。',
        items: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        context: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            map: { type: 'string', required: true, description: '结构地图。' },
            stack: { type: 'string', required: true, description: '技术栈。' },
            conventions: { type: 'string', required: true, description: '约定。' },
            gotchas: { type: 'string', required: true, description: '坑。' },
            topPaths: { type: 'integer', required: true, description: '常改文件条数。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (role === 'executor') {
        throw new Error('工程师不改项目上下文；把发现写进 report 文书，让项目经理/秘书去改');
      }
      const patch = {};
      if (str(args.map).trim()) patch.map = str(args.map).trim().slice(0, 2000);
      if (str(args.stack).trim()) patch.stack = str(args.stack).trim().slice(0, 1000);
      if (str(args.conventions).trim()) patch.conventions = str(args.conventions).trim().slice(0, 2000);
      if (str(args.gotchas).trim()) patch.gotchas = str(args.gotchas).trim().slice(0, 2000);
      if (Array.isArray(args.topPaths)) {
        patch.topPaths = args.topPaths.map((item) => str(item).trim()).filter(Boolean).slice(0, 40);
      }
      if (Object.keys(patch).length === 0) throw new Error('没有要写的字段（至少给 map/stack/conventions/gotchas/topPaths 之一）');
      let saved = null;
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        target.context = { ...(target.context ?? {}), ...patch };
        target.updatedAt = Date.now();
        saved = target.context;
      });
      return {
        context: {
          map: str(saved?.map),
          stack: str(saved?.stack),
          conventions: str(saved?.conventions),
          gotchas: str(saved?.gotchas),
          topPaths: Array.isArray(saved?.topPaths) ? saved.topPaths.length : 0,
        },
      };
    },
  ));

  // -- 文件归属与越界审计 ---------------------------------------------------
  ctx.tools.register(makeTool(
    'court_set_ownership',
    '声明本项目「谁可以改哪些文件」（≤60 条，支持 src/api/**、**/*.test.js、package.json 这种写法）。'
    + '派活前必须写清楚：没声明的项目，审计一律判「未声明归属」。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      patterns: {
        type: 'array',
        required: true,
        description: '路径模式（相对工作区根）。',
        items: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        declared: { type: 'integer', required: true, description: '已声明的模式条数。' },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (role === 'executor') throw new Error('工程师不改文件归属；改归属是派活（项目经理）或架构（架构师）的事');
      const patterns = (Array.isArray(args.patterns) ? args.patterns : [])
        .map((item) => str(item).trim())
        .filter(Boolean);
      if (patterns.length === 0) throw new Error('至少给一条路径模式；不知道写什么就先写 src/**');
      let declared = 0;
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        target.ownership = [...new Set(patterns)].slice(0, 60);
        target.updatedAt = Date.now();
        declared = target.ownership.length;
      });
      return { declared };
    },
  ));

  ctx.tools.register(makeTool(
    'court_set_manual',
    '《用户操作单》：把「只有人能做」的事列出来——配环境变量、去后台点按钮、真机扫码、开通账号、'
    + '掏钱买证书、找第三方审核。这些项工程师不能自己勾完成，必须由用户确认；'
    + '只要还有未完成项，项目就不能置 done（秘书/用户签字例外）。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      items: {
        type: 'array',
        required: true,
        description: '要用户做的事；传空数组表示清空。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: '省略则按序号生成。' },
            title: { type: 'string', required: true, description: '一句话说明要做什么。' },
            detail: { type: 'string', description: '怎么做、在哪里点、验收标准。' },
            blocking: { type: 'boolean', description: '不做就交付不了（默认 false）。' },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true, description: '清单条数。' },
        pending: { type: 'integer', required: true, description: '还没做的条数。' },
        blocking: { type: 'integer', required: true, description: '其中卡交付的条数。' },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (role === 'executor') {
        throw new Error('工程师可以提「这步要用户做」，但不能替自己写操作单；交给项目经理或秘书登记');
      }
      const raw = Array.isArray(args.items) ? args.items : [];
      const items = raw.slice(0, 40).map((item, index) => ({
        id: str(item?.id).trim() || `h${index + 1}`,
        title: str(item?.title).trim(),
        detail: str(item?.detail),
        blocking: item?.blocking === true,
        status: 'pending',
        at: Date.now(),
      })).filter((item) => item.title);
      let result = { total: 0, pending: 0, blocking: 0 };
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        target.manual = items;
        target.updatedAt = Date.now();
        result = {
          total: items.length,
          pending: items.length,
          blocking: items.filter((item) => item.blocking).length,
        };
      });
      return result;
    },
  ));

  ctx.tools.register(makeTool(
    'court_update_manual',
    '勾《用户操作单》里的一项——**只有秘书或用户本人能勾**，工程师勾不了。'
    + '用户说「那个我做完了」时，秘书用它逐项确认；不确定是哪一项就先 court_get_project 看清单。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      id: { type: 'string', required: true, description: '操作单条目 id。' },
      status: { type: 'string', description: 'done 或 pending，默认 done。' },
      note: { type: 'string', description: '用户的补充（做了什么、卡在哪）。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        item: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '条目 id。' },
            title: { type: 'string', required: true, description: '条目标题。' },
            status: { type: 'string', required: true, description: 'done / pending。' },
          },
        },
        pending: { type: 'integer', required: true, description: '还剩几项没做。' },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role, caller } = roleOf(state, project, exec);
      if (role !== 'secretary' && role !== 'user') {
        throw new Error('《用户操作单》只能由秘书或用户本人勾：工程师不能自己宣布「用户那步做完了」');
      }
      const id = str(args.id).trim();
      const status = str(args.status, 'done') === 'pending' ? 'pending' : 'done';
      const note = str(args.note).trim();
      let item = null;
      let pending = 0;
      await update((current) => {
        const target = current.projects[projectId];
        const list = Array.isArray(target.manual) ? target.manual : [];
        const found = list.find((entry) => entry.id === id);
        if (!found) throw new Error(`操作单里没有这一项：${id}`);
        found.status = status;
        found.confirmedBy = status === 'done' ? (caller || 'user') : null;
        found.at = Date.now();
        if (note) found.note = note.slice(0, 500);
        target.updatedAt = Date.now();
        item = { id: found.id, title: found.title, status: found.status };
        pending = list.filter((entry) => entry.status !== 'done').length;
      });
      return { item, pending };
    },
  ));

  ctx.tools.register(makeTool(
    'court_set_quote',
    '报价：派活之前先写下「这事打算花多少」——几轮返工、多少 token。'
    + '之后驳回轮次与验收次数会自动记账，超了就在索引里标出来，'
    + '免得做到一半才发现这单根本不值（外包公司先报价再施工，一个道理）。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      rounds: { type: 'integer', description: '预计最多返工几轮（默认按编制上限）。' },
      tokenBudget: { type: 'integer', description: '预计 token 预算（整数，单位 token）。' },
      note: { type: 'string', description: '为什么值这个价（可选）。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        quote: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            rounds: { type: 'integer', required: true, description: '轮次预算。' },
            tokenBudget: { type: 'integer', required: true, description: 'token 预算。' },
            note: { type: 'string', required: true, description: '备注。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (role === 'executor') throw new Error('报价是项目经理/架构师的事，工程师只管干');
      const cap = SHAPE_META[shapeOf(project)].rejectCap;
      const rounds = Math.max(0, Math.min(num(args.rounds, cap), 20));
      const tokenBudget = Math.max(0, num(args.tokenBudget, 0));
      const note = str(args.note).slice(0, 500);
      let saved = null;
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        target.quote = { rounds, tokenBudget, note, at: Date.now(), by: role || 'user' };
        target.updatedAt = Date.now();
        saved = { rounds, tokenBudget, note };
      });
      return { quote: saved };
    },
  ));

  // -- 时间盒：到点不自动续，续期要留痕 ---------------------------------------
  ctx.tools.register(makeTool(
    'court_set_appetite',
    '设定或延期时间盒（愿意花多久，而不是估多久）。默认：轻量组 8 小时、项目组 40 小时、流水线不设。'
    + '到点后巡夜只报一次，把「砍范围 / 延期 / 结项」三选一交给客户；延期必须在这里留下谁批的、加了多少。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      hours: { type: 'number', description: '新的总时长（小时）。改这个等于重新定时，历史延期仍保留。' },
      extendHours: { type: 'number', description: '只追加时长（小时），用于到点后的「延期」。' },
      note: { type: 'string', description: '为什么加时（客户原话最好）。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        appetite: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            hours: { type: 'number', required: true, description: '当前总时长（小时）。' },
            usedHours: { type: 'number', required: true, description: '已用（小时）。' },
            over: { type: 'boolean', required: true, description: '是否已超时。' },
            extensions: { type: 'integer', required: true, description: '延期次数。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (role === 'executor') throw new Error('时间盒由项目经理/架构师定，客户签字；工程师不给自己改工期');
      const hours = num(args.hours, 0);
      const extendHours = num(args.extendHours, 0);
      if (!(hours > 0) && !(extendHours > 0)) {
        throw new Error('要么给 hours（重定总时长），要么给 extendHours（追加）；两个都空没法改');
      }
      const now = Date.now();
      let view = null;
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        const box = target.appetite && typeof target.appetite === 'object' ? target.appetite : {};
        if (hours > 0) {
          box.maxMs = Math.min(2000, hours) * 3600 * 1000;
          box.breachedAt = null;
        }
        if (extendHours > 0) {
          box.maxMs = (Number(box.maxMs) || 0) + Math.min(2000, extendHours) * 3600 * 1000;
          box.breachedAt = null;
          box.extensions = Array.isArray(box.extensions) ? box.extensions : [];
          box.extensions.push({
            at: now,
            by: role || 'user',
            addMs: Math.min(2000, extendHours) * 3600 * 1000,
            note: str(args.note).slice(0, 200),
          });
          box.extensions = box.extensions.slice(-20);
        }
        if (!box.startedAt) box.startedAt = target.createdAt || now;
        target.appetite = box;
        target.updatedAt = now;
        const usedMs = Math.max(0, now - (Number(box.startedAt) || now));
        view = {
          hours: Math.round((Number(box.maxMs) / 3600000) * 10) / 10,
          usedHours: Math.round((usedMs / 3600000) * 10) / 10,
          over: usedMs >= Number(box.maxMs),
          extensions: Array.isArray(box.extensions) ? box.extensions.length : 0,
        };
      });
      return { appetite: view };
    },
  ));

  // -- 优先级四象限：重要 / 紧急 ---------------------------------------------
  ctx.tools.register(makeTool(
    'court_set_priority',
    '给项目定四象限：重要（影响长期目标/交付质量）× 紧急（有硬期限或别人在等）。'
    + '立项后客户改主意也用它。两个都 false 就是「不重要不紧急」，不会插队，排在后面。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      important: { type: 'boolean', description: '是否重要。' },
      urgent: { type: 'boolean', description: '是否紧急。' },
      note: { type: 'string', description: '为什么调（客户原话最好）。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        priority: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            important: { type: 'boolean', required: true, description: '重要。' },
            urgent: { type: 'boolean', required: true, description: '紧急。' },
            quadrant: { type: 'string', required: true, description: '四象限键。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (role === 'executor') throw new Error('优先级是客户/项目经理排的，工程师不给自己插队');
      const important = typeof args.important === 'boolean' ? args.important : Boolean(project.priority?.important);
      const urgent = typeof args.urgent === 'boolean' ? args.urgent : Boolean(project.priority?.urgent);
      let view = null;
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        target.priority = { important, urgent };
        target.updatedAt = Date.now();
        view = { important, urgent, quadrant: quadrantOf(target) };
      });
      return { priority: view };
    },
  ));

  ctx.tools.register(makeTool(
    'court_audit',
    '越界审计：拿基线快照对比当前工作区，把改动分成「归属内」和「越界」两栏。'
    + '验收前跑一次：越界的文件必须有人解释，或者把归属补上。只读，不改文件。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      limit: { type: 'integer', description: '每栏最多列多少个文件（默认 40，最多 200）。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        verdict: { type: 'string', required: true, description: 'ok / undeclared / out-of-scope。' },
        declared: { type: 'integer', required: true, description: '已声明的归属条数。' },
        summary: { type: 'string', required: true, description: '一句话结论。' },
        inScope: { type: 'array', required: true, description: '归属内的改动文件。', items: { type: 'string' } },
        outOfScope: { type: 'array', required: true, description: '越界的改动文件。', items: { type: 'string' } },
      },
    },
    async (args) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const dir = str(project.workspace?.path);
      if (!dir) throw new Error('项目还没有工作区，无法审计改动');
      const baseline = await loadBaseline(projectId);
      if (!baseline) throw new Error('没有基线快照：基线在移交时建立，先走一次 court_handoff');
      const diff = await diffSnapshot(dir, baseline);
      const changed = [
        ...(diff?.added ?? []),
        ...(diff?.modified ?? []),
        ...(diff?.removed ?? []),
      ];
      const limit = Math.min(200, Math.max(1, num(args.limit, 40)));
      const audit = auditChanges(project, changed);
      return {
        verdict: audit.verdict,
        declared: audit.declared,
        summary: describeAudit(audit),
        inScope: audit.inScope.slice(0, limit),
        outOfScope: audit.outOfScope.slice(0, limit),
      };
    },
  ));

  // -- 文书修订：打补丁，不重发全文 -----------------------------------------
  ctx.tools.register(makeTool(
    'court_revise_brief',
    '按 find/replace 补丁修订一份已有文书（尤其是被驳回的方案）。不要用 court_save_brief 重发全文；' +
      '每次修订都会留下版本记录，正文只保留最新一版。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      briefId: { type: 'string', required: true, description: '要修订的文书 id。' },
      edits: {
        type: 'array',
        description: 'find/replace 列表，最多 20 条；find 必须在原文中唯一出现。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            find: { type: 'string', required: true, description: '原文片段（必须唯一）。' },
            replace: { type: 'string', required: true, description: '替换成什么；可为空串。' },
          },
        },
      },
      append: { type: 'string', description: '在文末追加的短补丁（可选；不要用它整段重写）。' },
      title: { type: 'string', description: '新标题（可选）。' },
      summary: { type: 'string', description: '新摘要（可选）。' },
      note: { type: 'string', description: '修订理由。' },
      fixes: {
        type: 'array',
        description: '本次处理了评审意见的哪几条（mustFix 的序号，1 起）。被驳回过的文书必填：逐条清账，不许整篇重发。',
        items: { type: 'integer' },
      },
      scopeImpact: {
        type: 'string',
        description: 'none（纯文档修正）/ material（改范围/模型/依赖/验收口径，默认）。',
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        brief: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '文书 id。' },
            version: { type: 'integer', required: true, description: '修订后的版本号。' },
            chars: { type: 'integer', required: true, description: '修订后的字符数。' },
            edits: { type: 'integer', required: true, description: '本次应用的补丁条数。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const briefId = str(args.briefId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const brief = project.briefs.find((item) => item.id === briefId);
      if (!brief) throw new Error(`文书不存在：${briefId}`);
      const { role } = roleOf(state, project, exec);
      if (!canSaveBrief(role, brief.kind)) {
        throw new Error(`角色 ${role || 'unknown'} 不能修订 ${brief.kind} 文书`);
      }
      if (brief.kind === 'verdict' || brief.kind === 'review') {
        throw new Error('审核结论不能修订；请重新 court_submit_verdict');
      }

      const edits = Array.isArray(args.edits)
        ? args.edits.map((edit, index) => ({
          find: str(edit?.find),
          replace: str(edit?.replace),
          index,
        }))
        : [];
      if (edits.length > 20) throw new Error('一次最多 20 条补丁');
      let patchChars = 0;
      for (const edit of edits) {
        if (!edit.find) throw new Error(`第 ${edit.index + 1} 条补丁的 find 不能为空`);
        if (edit.find.length > 20000 || edit.replace.length > 20000) {
          throw new Error(`第 ${edit.index + 1} 条补丁过长（find/replace 各限 20000 字符）`);
        }
        patchChars += edit.find.length + edit.replace.length;
      }
      const append = str(args.append);
      if (edits.length === 0 && !append.trim()) throw new Error('至少需要一条补丁或一段 append');
      if (patchChars + append.length > 50000) throw new Error('本次补丁总长度超过 50000 字符；请拆小');

      // 被驳回过的文书必须逐条清账：说清这次改的是哪几条 mustFix。
      // v1.7 的病根是「驳回一次 → 全文重发 → 评审再审全文 → 又发现新问题」，
      // 六轮下来 449K 字符。清账式修订让评审只核这几条。
      const pendingMustFix = project.latestVerdict && project.latestVerdict.decision === 'reject'
        ? (project.latestVerdict.mustFix || [])
        : [];
      const fixes = Array.isArray(args.fixes)
        ? [...new Set(args.fixes.map((value) => num(value, 0)).filter((value) => value > 0))]
        : [];
      if (pendingMustFix.length > 0) {
        if (fixes.length === 0) {
          throw new Error(
            `这份文书正被驳回，还有 ${pendingMustFix.length} 条 mustFix 没清账：修订必须传 fixes:[1,2] 指明本次改的是哪几条。`
            + '不要全文重发。待处理：\n'
            + pendingMustFix.map((item, index) => `  ${index + 1}. ${str(item.issue).slice(0, 160)}`).join('\n'),
          );
        }
        const outOfRange = fixes.filter((value) => value > pendingMustFix.length);
        if (outOfRange.length > 0) {
          throw new Error(`fixes 里有超出范围的序号 ${outOfRange.join('、')}：本次驳回只有 ${pendingMustFix.length} 条 mustFix。`);
        }
      }

      let content = str(brief.content);
      for (const edit of edits) {
        const first = content.indexOf(edit.find);
        if (first < 0) throw new Error(`第 ${edit.index + 1} 条补丁的 find 在原文中找不到`);
        if (content.indexOf(edit.find, first + 1) >= 0) {
          throw new Error(`第 ${edit.index + 1} 条补丁的 find 在原文中出现多次；请写得更具体`);
        }
        content = content.slice(0, first) + edit.replace + content.slice(first + edit.find.length);
      }
      if (append.trim()) {
        content = `${content.replace(/\s+$/, '')}\n\n${append.trim()}\n`;
      }
      if (content.length > 200000) throw new Error('修订后正文超过 200000 字符；请拆成多份文书');
      // 修订允许把超预算的老文书改短，但不允许越改越长。
      const reviseBudget = budgetOf(brief.kind);
      if (content.length > reviseBudget && content.length > str(brief.content).length) {
        const tooLong = new Error(
          `修订后 ${content.length} 字符，超过 ${brief.kind} 预算 ${reviseBudget}：修订反而变长了。`
          + '请把新增内容写成另一份 brief（court_save_brief），或删掉不再需要的段落再改。',
        );
        tooLong.code = 'BRIEF_TOO_LONG';
        throw tooLong;
      }

      const version = Math.max(1, num(brief.version, 1)) + 1;
      const scopeImpact = str(args.scopeImpact) === 'none' ? 'none' : 'material';
      await update((current) => {
        const targetProject = current.projects[projectId];
        const target = targetProject.briefs.find((item) => item.id === briefId);
        if (!target) throw new Error(`文书不存在：${briefId}`);
        target.content = content;
        target.version = version;
        target.updatedAt = Date.now();
        if (str(args.title).trim()) target.title = str(args.title).trim();
        if (str(args.summary).trim()) target.summary = str(args.summary).trim();
        target.revisions = Array.isArray(target.revisions) ? target.revisions : [];
        target.revisions.push({
          at: Date.now(),
          by: role,
          version,
          note: str(args.note),
          fixes,
          edits: edits.map((edit) => ({ find: edit.find, replace: edit.replace })),
          append,
        });
        target.revisions = target.revisions.slice(-10);

        if (target.kind === 'plan' || target.kind === 'report') targetProject.latestVerdict = null;
        if (target.kind === 'plan'
          && (targetProject.scope.approvedPlanId || targetProject.scope.approvedAt)
          && scopeImpact === 'material') {
          targetProject.scope.drift = {
            at: Date.now(),
            by: role,
            reason: str(args.note) || '方案修订（material）',
            fromPlanId: targetProject.scope.approvedPlanId || '',
            toPlanId: target.id,
          };
          targetProject.scope.confirmedAt = 0;
          targetProject.scope.confirmedBy = '';
        }
        targetProject.updatedAt = Date.now();
      });

      return { brief: { id: briefId, version, chars: content.length, edits: edits.length } };
    },
  ));

  // -- 审核结论：must-fix 才阻塞，notes 只标注 -------------------------------
  ctx.tools.register(makeTool(
    'court_submit_verdict',
    '提交结构化审核结论：decision=pass/reject；reject 必须给 1–3 条 mustFix（阻塞）；' +
      '文档一致性、措辞、索引编号等放 notes（不阻塞）。不要再用 court_save_brief(kind=verdict) 写散文。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      decision: { type: 'string', required: true, description: 'pass 或 reject。' },
      mustFix: {
        type: 'array',
        description: '必须修复项，最多 3 条；只有这些会阻塞。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            issue: { type: 'string', required: true, description: '问题，具体到可改。' },
            evidence: { type: 'string', description: '证据：文件/行/命令/复现。' },
          },
        },
      },
      notes: {
        type: 'array',
        description: '非阻塞备注，最多 10 条。',
        items: { type: 'string' },
      },
      summary: { type: 'string', description: '一句话结论。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        verdict: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'verdict 文书 id。' },
            decision: { type: 'string', required: true, description: 'pass/reject。' },
            phase: { type: 'string', required: true, description: 'menxia（方案）或 review（交付）。' },
            must_fix_count: { type: 'integer', required: true, description: '阻塞项数量。' },
            note_count: { type: 'integer', required: true, description: '非阻塞备注数量。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (!canSubmitVerdict(role)) throw new Error('只有评审（评审）可以提交审核结论');
      const phase = project.status;
      if (phase !== 'menxia' && phase !== 'review') {
        throw new Error(`当前状态 ${phase} 不是审核阶段（menxia/review）`);
      }
      const decision = str(args.decision).trim().toLowerCase();
      if (decision !== 'pass' && decision !== 'reject') throw new Error('decision 只能是 pass 或 reject');
      const mustFix = Array.isArray(args.mustFix)
        ? args.mustFix.slice(0, 4).map((item) => ({
          issue: str(item?.issue).trim(),
          evidence: str(item?.evidence).trim(),
        })).filter((item) => item.issue)
        : [];
      if (mustFix.length > 3) throw new Error('mustFix 最多 3 条；其余放 notes');
      if (decision === 'reject' && mustFix.length === 0) {
        throw new Error('reject 必须给至少 1 条 mustFix；纯文档问题请给 pass + notes');
      }
      if (decision === 'pass' && mustFix.length > 0) {
        throw new Error('pass 不能带 mustFix；如果仍需修改请用 reject');
      }
      const notes = Array.isArray(args.notes)
        ? args.notes.map((item) => str(item).trim()).filter(Boolean).slice(0, 10)
        : [];

      if (decision === 'pass'
        && project.scope.drift && project.scope.confirmedAt < project.scope.drift.at) {
        throw new Error('方案相对已批准范围有 material 变更，且用户尚未 court_confirm_scope；不能直接 pass');
      }
      if (decision === 'pass' && phase === 'review' && project.checks.length > 0) {
        const startedAt = project.executorStartedAt || 0;
        const verification = [...project.verifications]
          .reverse()
          .find((item) => item.at >= startedAt && item.ok && item.by === 'menxia');
        if (!verification) throw new Error('交付复核 pass 前，评审必须先 court_verify 一次并全部通过');
      }

      const round = (project.reviewRound || 0) + 1;
      const lines = [
        `# 审核结论：${decision === 'pass' ? '通过' : '驳回'}（第 ${round} 轮，${phase === 'menxia' ? '方案' : '交付'}）`,
        '',
        str(args.summary).trim() || (decision === 'pass' ? '无阻塞项，放行。' : '存在阻塞项，退回修改。'),
        '',
      ];
      if (mustFix.length > 0) {
        lines.push('## 必须修复（阻塞）', '');
        mustFix.forEach((item, index) => {
          lines.push(`${index + 1}. ${item.issue}${item.evidence ? `（证据：${item.evidence}）` : ''}`);
        });
        lines.push('');
      }
      if (notes.length > 0) {
        lines.push('## 备注（不阻塞，可滚动修补）', '');
        notes.forEach((note) => lines.push(`- ${note}`));
        lines.push('');
      }
      const content = lines.join('\n');
      const brief = {
        id: makeId('b'),
        kind: 'verdict',
        title: `审核结论（${decision === 'pass' ? '通过' : '驳回'}）· ${phase === 'menxia' ? '方案' : '交付'}`,
        summary: str(args.summary).trim()
          || (decision === 'pass' ? '通过' : `驳回：${mustFix.length} 条必须修复`),
        content,
        author: 'menxia',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
        revisions: [],
        decision,
        phase,
        mustFix,
        notes,
      };

      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        target.briefs.push(brief);
        target.latestVerdict = {
          id: brief.id,
          decision,
          phase,
          mustFix,
          notes,
          at: Date.now(),
        };
        if (decision === 'pass' && phase === 'menxia') {
          const plan = latestBrief(target, 'plan');
          target.scope.approvedPlanId = plan ? plan.id : target.scope.approvedPlanId;
          target.scope.approvedAt = Date.now();
        }
        target.updatedAt = Date.now();
      });

      return {
        verdict: {
          id: brief.id,
          decision,
          phase,
          must_fix_count: mustFix.length,
          note_count: notes.length,
        },
      };
    },
  ));

  // -- 需求基线确认：material 变更必须由秘书/用户点头 ------------------------
  ctx.tools.register(makeTool(
    'court_confirm_scope',
    '确认“这次的需求基线没漂移/漂移可接受”。方案在已批准后发生 material 变更时，' +
      'court_handoff 到 shangshu/executor 会被拦住，必须先由秘书（或用户）调用它。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      note: { type: 'string', description: '确认理由 / 用户原话。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        scope: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            original: { type: 'string', required: true, description: '最初需求。' },
            approved_plan_id: { type: 'string', required: true, description: '当前批准方案 id。' },
            confirmed_at: { type: 'integer', required: true, description: '确认时间戳。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (!canConfirmScope(role)) throw new Error('只有秘书（或用户）可以确认需求基线');
      // 签字签的是一份真实存在的方案：没有它，签字只是把空范围盖了个章。
      const plan = latestBrief(project, 'plan') ?? latestBrief(project, 'contract');
      if (!plan) {
        const missing = new Error(
          '没有可签的方案：先让架构师用 court_save_brief(kind=plan 或 contract) 交出方案，再来 court_confirm_scope。'
          + '（v1.7 允许签一份不存在的方案，于是「范围」永远是个空概念）',
        );
        missing.code = 'MISSING_OUTPUT';
        throw missing;
      }
      const now = Date.now();
      let result = null;
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        target.scope.confirmedAt = now;
        target.scope.confirmedBy = role || 'user';
        if (plan) {
          target.scope.approvedPlanId = plan.id;
          target.scope.approvedAt = now;
        }
        target.history.push({
          at: now,
          from: target.status,
          to: target.status,
          by: role || 'user',
          note: `需求基线确认：${str(args.note) || '无备注'}`,
          reportId: null,
        });
        target.updatedAt = now;
        result = {
          original: target.scope.original,
          approved_plan_id: target.scope.approvedPlanId || '',
          confirmed_at: target.scope.confirmedAt,
        };
      });
      return { scope: result };
    },
  ));

  // -- 移交 ---------------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_handoff',
    '移交：把项目交给下一省。会（复用或新开）目标省的会话并在其中投递文书与任务。' +
      '轻量编制（squad）：架构师→shangshu，项目经理→executing 自己开工，干完→review 等秘书抽验；' +
      '完整编制（crew）：架构师→menxia，评审 pass→shangshu、reject→zhongshu，项目经理→executor；' +
      '批量编制（line）：架构师→shangshu，项目经理→executor 派多条工单。编制里没有的席位会被拒绝。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      to: {
        type: 'string',
        required: true,
        description: '目标：zhongshu（驳回回架构师）/ menxia（提评审）/ shangshu（通过）/ executor（派活）。',
      },
      briefTitle: { type: 'string', description: '同时新建一份文书时的标题。' },
      briefContent: { type: 'string', description: '文书正文；与 briefTitle 一起给出时先存文书再移交。' },
      note: { type: 'string', description: '给目标省的额外交代（例如审核要点、要用户确认的问题）。' },
      workspacePath: { type: 'string', description: '仅对 executor：执行工作区路径；省略则用项目已记录的工作区。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', required: true, description: '目标会话 id。' },
        status: { type: 'string', required: true, description: '移交后的项目状态。' },
        reused: { type: 'boolean', required: true, description: '是否复用了该省已有会话。' },
      },
    },
    async (args, exec) => {
      const state = await read();
      const project = state.projects[str(args.projectId)];
      if (!project) throw new Error(`项目不存在：${str(args.projectId)}`);
      const { role } = roleOf(state, project, exec);
      return performHandoff(ctx, {
        projectId: str(args.projectId),
        to: str(args.to),
        from: role || 'unknown',
        note: str(args.note),
        briefTitle: str(args.briefTitle),
        briefContent: str(args.briefContent),
        workspacePath: str(args.workspacePath),
      });
    },
  ));

  // -- 工作区 -------------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_set_workspace',
    '为项目确定执行工作区（项目管理的职责）。会校验目录、在侧栏登记为工作区。' +
      '新建目录可以，但要先问用户是不是已有现成文件夹。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      path: { type: 'string', required: true, description: '绝对路径。' },
      create: { type: 'boolean', description: '目录不存在时是否创建，默认 false。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspace: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '工作区 id，可能为空。' },
            path: { type: 'string', required: true, description: '规范化后的路径。' },
            created: { type: 'boolean', required: true, description: '本次是否新建了目录。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const dirPath = str(args.path).trim();
      if (!dirPath) throw new Error('路径不能为空');
      if (!path.isAbsolute(dirPath)) throw new Error('工作区必须是绝对路径');
      if (path.parse(dirPath).root === dirPath) throw new Error('不能把磁盘根目录当作项目工作区');

      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (!canSetWorkspace(role, project.status)) {
        throw new Error(`角色 ${role || 'unknown'} 不能在 ${project.status} 阶段改工作区`);
      }

      let exists = true;
      try {
        const info = await fs.stat(dirPath);
        exists = info.isDirectory();
      } catch {
        exists = false;
      }
      let created = false;
      if (!exists) {
        if (args.create !== true) throw new Error(`目录不存在：${dirPath}；确实要新建请传 create: true`);
        await ensureDir(dirPath);
        created = true;
      }

      const workspace = await ensureWorkspace(ctx, dirPath, path.basename(dirPath));

      // 开工基线：记下现在的文件清单，交付时用来核对“到底动了哪些文件”
      let baseline = null;
      try {
        const snapshot = await takeSnapshot(dirPath);
        await archiveBaseline(projectId);
        await saveBaseline(projectId, snapshot);
        baseline = {
          kind: snapshot.kind,
          at: snapshot.at,
          commit: snapshot.commit,
          count: snapshot.count,
          truncated: snapshot.truncated,
        };
      } catch (error) {
        console.warn('[court] 基线快照失败：', error?.message ?? error);
      }

      await update((current) => {
        const project = current.projects[projectId];
        project.workspace = { id: workspace ? workspace.id : '', path: dirPath };
        project.baseline = baseline;
        project.deliveryDiff = null;
        project.updatedAt = Date.now();
        current.pendingJump = null;
      });

      return {
        workspace: { id: workspace ? workspace.id : '', path: dirPath, created },
      };
    },
  ));

  // -- 工作区迁移：路径错了要能修，不能把人锁死 -----------------------------
  ctx.tools.register(makeTool(
    'court_rebase_workspace',
    '把项目工作区迁到新路径并重拍基线。用于路径写错/项目搬家；会保留旧基线、清空旧验证，' +
      '并写一条迁移记录。工程师在 executing/blocked 时可以纠正路径，但必须写 reason。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      path: { type: 'string', required: true, description: '新的绝对路径。' },
      reason: { type: 'string', required: true, description: '为什么迁移，旧路径错在哪。' },
      create: { type: 'boolean', description: '目录不存在时是否创建，默认 false。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspace: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '工作区 id，可能为空。' },
            path: { type: 'string', required: true, description: '新路径。' },
            previous: { type: 'string', required: true, description: '旧路径。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const dirPath = str(args.path).trim();
      const reason = str(args.reason).trim();
      if (!dirPath) throw new Error('路径不能为空');
      if (!reason) throw new Error('迁移工作区必须写 reason');
      if (!path.isAbsolute(dirPath)) throw new Error('工作区必须是绝对路径');
      if (path.parse(dirPath).root === dirPath) throw new Error('不能把磁盘根目录当作项目工作区');
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (!canRebaseWorkspace(role, project.status)) {
        throw new Error(`角色 ${role || 'unknown'} 不能在 ${project.status} 阶段迁移工作区`);
      }
      const previous = project.workspace && project.workspace.path ? project.workspace.path : '';
      if (previous && samePath(previous, dirPath)) throw new Error('新旧工作区路径相同');
      let exists = true;
      try {
        const info = await fs.stat(dirPath);
        exists = info.isDirectory();
      } catch {
        exists = false;
      }
      if (!exists) {
        if (args.create !== true) throw new Error(`目录不存在：${dirPath}；确实要新建请传 create: true`);
        await ensureDir(dirPath);
      }
      const workspace = await ensureWorkspace(ctx, dirPath, path.basename(dirPath));
      await archiveBaseline(projectId);
      let baseline = null;
      try {
        const snapshot = await takeSnapshot(dirPath);
        await saveBaseline(projectId, snapshot);
        baseline = {
          kind: snapshot.kind,
          at: snapshot.at,
          commit: snapshot.commit,
          count: snapshot.count,
          truncated: snapshot.truncated,
        };
      } catch (error) {
        console.warn('[court] 迁移后基线快照失败：', error?.message ?? error);
      }
      const now = Date.now();
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        const wasBlocked = target.status === 'blocked';
        target.workspace = { id: workspace ? workspace.id : '', path: dirPath };
        target.baseline = baseline;
        target.deliveryDiff = null;
        target.verifications = [];
        target.lastVerificationId = null;
        target.latestVerdict = null;
        target.executorStartedAt = now;
        target.workspaceMoves.push({ at: now, by: role || 'unknown', from: previous, to: dirPath, reason });
        target.workspaceMoves = target.workspaceMoves.slice(-20);
        target.history.push({
          at: now,
          from: target.status,
          to: target.status,
          by: role || 'unknown',
          note: `工作区迁移：${previous || '（无）'} → ${dirPath}；${reason}`,
          reportId: null,
        });
        if (wasBlocked && role === 'executor') {
          target.status = 'executing';
          target.statusBeforeBlocked = null;
          target.blockedReason = null;
          target.history.push({
            at: now,
            from: 'blocked',
            to: 'executing',
            by: 'executor',
            note: '工作区路径已纠正，恢复执行',
            reportId: null,
          });
        }
        target.updatedAt = now;
        current.pendingJump = null;
      });
      return {
        workspace: { id: workspace ? workspace.id : '', path: dirPath, previous },
      };
    },
  ));

  // -- 状态/里程碑 --------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_update_project',
    '更新项目状态或勾选里程碑（进度由里程碑权重算出）。工程师完成一项就勾一项。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      status: { type: 'string', description: '新状态：draft/zhongshu/menxia/shangshu/executing/review/done/archived/blocked。' },
      blockedReason: { type: 'string', description: 'status=blocked 时说明卡在哪。' },
      note: { type: 'string', description: '给下一方的说明。项目管理打回时在这里写「必须返工的具体点」。' },
      milestoneId: { type: 'string', description: '要切换的里程碑 id。' },
      milestoneDone: { type: 'boolean', description: '里程碑的新完成态。' },
      milestones: {
        type: 'array',
        description: '整体替换里程碑列表（架构组定小目标时用）。给出即覆盖，权重按百分比算。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true, description: '小目标。' },
            weight: { type: 'integer', required: true, description: '权重（占比）。' },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        project: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '项目 id。' },
            status: { type: 'string', required: true, description: '状态。' },
            progress: { type: 'integer', required: true, description: '进度百分比。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const before = await read();
      const project0 = before.projects[projectId];
      if (!project0) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(before, project0, exec);
      if (!role) throw new Error('无法识别调用者角色：这个会话不属于当前项目的任何一省');
      const wanted = str(args.status)
        || (typeof args.blockedReason === 'string' && args.blockedReason ? 'blocked' : '');
      const replacing = Array.isArray(args.milestones) && args.milestones.length > 0;
      const latestReport = project0.briefs
        .filter((brief) => brief.kind === 'report')
        .slice(-1)[0] ?? null;
      const startedAt = project0.executorStartedAt || 0;

      const shape = shapeOf(project0);
      const hasMenxia = hasSeat(shape, 'menxia');
      /** 干活的省：完整/批量编制是工程师，轻量编制没有工程师席位，项目经理自己干。 */
      const doerRole = hasSeat(shape, 'executor') ? 'executor' : 'shangshu';
      if (wanted && !canUpdateStatus(project0.status, role, wanted, shape)) {
        throw new Error(
          `角色 ${role} 不能用 update 把项目从 ${project0.status} 改到 ${wanted}` +
          `（编制：${SHAPE_META[shape].label}）；省际推进请用 court_handoff`,
        );
      }
      if (wanted === 'blocked' && !str(args.blockedReason).trim()) {
        throw new Error('置 blocked 必须写 blockedReason（具体缺什么信息/卡在哪），不能把 blocked 当默认出口');
      }
      if (wanted === 'done') {
        const canJudge = role === 'secretary'
          || (hasMenxia && role === 'menxia')
          || (shape === 'line' && role === 'shangshu');
        if (!canJudge) {
          throw new Error(
            `验收结论只能由${hasMenxia ? '评审（评审）、' : ''}秘书给出；` +
            '干活的人不能给自己判合格。轻量编制的抽验一律由秘书做。',
          );
        }
        // 评审的 verdict 只在有评审席位的编制里存在；轻量/批量编制改用「验收命令 + 交付说明」。
        if (hasMenxia) {
          if (!project0.latestVerdict
            || project0.latestVerdict.decision !== 'pass'
            || project0.latestVerdict.phase !== 'review') {
            throw new Error('置 done 前，评审必须先 court_submit_verdict(pass, phase=review)');
          }
        } else {
          const hasReport = project0.briefs.some(
            (brief) => brief.kind === 'report' && (brief.createdAt || 0) >= startedAt,
          );
          if (!hasReport) {
            throw new Error('置 done 前必须有一份 kind=report 的交付说明（项目管理写完活后自己写）');
          }
        }
        if (project0.scope.drift && project0.scope.confirmedAt < project0.scope.drift.at) {
          throw new Error('方案有 material 变更且用户未确认；先 court_confirm_scope 再结项');
        }
        // 《用户操作单》还有没做的，就不能宣布交付——这些事只有人能做，
        // 工程师/项目经理自己勾 done 等于把「用户还没配好环境」说成「已经配好」。
        const pendingManual = (project0.manual ?? []).filter((item) => item.status !== 'done');
        if (pendingManual.length > 0 && role !== 'secretary' && role !== 'user') {
          throw new Error(
            `《用户操作单》还有 ${pendingManual.length} 项没完成（${pendingManual.slice(0, 3).map((item) => item.title).join('、')}）。`
            + '这些只有用户能做：请他做完，秘书用 court_update_manual 逐项确认后再结项。',
          );
        }
        // 越界审计：声明过归属的项目，交付前必须没有越界改动（秘书可以放行，但要留痕）。
        if ((project0.ownership ?? []).length > 0 && str(project0.workspace?.path)) {
          const baseline = await loadBaseline(projectId);
          if (baseline) {
            const diff = await diffSnapshot(str(project0.workspace.path), baseline).catch(() => null);
            if (!diff) {
              throw new Error('越界审计失败：工作区读不到（目录被移走或删了），先 court_rebase_workspace 修好再结项');
            }
            const changed = [
              ...(diff?.added ?? []),
              ...(diff?.modified ?? []),
              ...(diff?.removed ?? []),
            ];
            const audit = auditChanges(project0, changed);
            if (audit.verdict === 'out-of-scope' && role !== 'secretary') {
              throw new Error(
                `越界审计未通过：${audit.outOfScope.length} 个文件不在归属内（${audit.outOfScope.slice(0, 5).join('、')}）。`
                + '要么把这些文件改成你负责的、要么由秘书 court_set_ownership 补上归属，再结项。',
              );
            }
          }
        }
      }
      if (wanted === 'executing' && project0.status === 'review' && hasMenxia) {
        if (!project0.latestVerdict
          || project0.latestVerdict.decision !== 'reject'
          || project0.latestVerdict.phase !== 'review') {
          throw new Error('打回返工前，评审必须先 court_submit_verdict(reject, phase=review) 并给 mustFix');
        }
      }
      if (wanted === 'review') {
        if (role !== doerRole) {
          throw new Error(`只有${doerRole === 'executor' ? '工程师' : '项目管理'}可以把自己负责的活置为 review。`);
        }
        const hasReport = project0.briefs.some(
          (brief) => brief.kind === 'report' && (brief.createdAt || 0) >= startedAt,
        );
        if (!hasReport) {
          throw new Error('置 review 之前必须先 court_save_brief 写一份 kind=report 的交付说明（署名由系统记录）。');
        }
      }
      if (wanted === 'review' && project0.checks.length > 0) {
        const verification = [...project0.verifications]
          .reverse()
          .find((item) => item.at >= startedAt);
        if (!verification || !verification.ok) {
          throw new Error(
            `项目登记了验收命令（${project0.checks.map((c) => c.id).join('、')}），` +
            `必须先 court_verify 全部通过才能置 review。`,
          );
        }
      }
      if (wanted === 'done' && project0.checks.length > 0) {
        // 结项要求“独立验证”：评审（或秘书）自己跑过一遍，不能只采信工程师的结果。
        const verification = [...project0.verifications]
          .reverse()
          .find((item) => item.at >= startedAt && item.ok
            && (item.by === 'menxia' || item.by === 'secretary'));
        if (!verification) {
          throw new Error('置 done 之前，评审/秘书必须自己 court_verify 一次并全部通过');
        }
      }
      if (replacing) {
        if (!['zhongshu', 'shangshu', 'secretary'].includes(role)) {
          throw new Error(`角色 ${role} 不能重定里程碑；只有架构师/项目经理/秘书可以。`);
        }
        if (!str(args.note).trim()) {
          throw new Error('重定里程碑要在 note 里写明变更理由，否则不能替换。');
        }
      }
      const milestoneId = str(args.milestoneId);
      if (milestoneId && !project0.milestones.some((item) => item.id === milestoneId)) {
        throw new Error(`里程碑不存在：${milestoneId}`);
      }

      let view = null;
      let prevStatus = null;
      let nextStatus = null;
      await update((state) => {
        const project = state.projects[projectId];
        if (!project) throw new Error(`项目不存在：${projectId}`);
        prevStatus = project.status;
        if (typeof args.note === 'string') project.lastNote = args.note || null;
        if (Array.isArray(args.milestones) && args.milestones.length > 0) {
          project.milestones = args.milestones.map((m, index) => ({
            id: `m${index + 1}`,
            title: str(m?.title, `里程碑 ${index + 1}`),
            weight: Math.max(1, num(m?.weight, 10)),
            done: Boolean(m?.done),
            doneAt: m?.done ? Date.now() : null,
          }));
          project.milestoneRevision = {
            at: Date.now(),
            by: role || 'unknown',
            reason: str(args.note),
          };
        }
        if (wanted) {
          project.status = wanted;
          if (wanted !== 'blocked') project.blockedReason = null;
        }
        if (typeof args.blockedReason === 'string') {
          project.blockedReason = args.blockedReason || null;
          if (args.blockedReason) project.status = 'blocked';
        }
        if (project.status === 'done') project.completedAt = Date.now();
        if (milestoneId) {
          const milestone = project.milestones.find((m) => m.id === milestoneId);
          if (!milestone) throw new Error(`里程碑不存在：${milestoneId}`);
          milestone.done = args.milestoneDone !== false;
          milestone.doneAt = milestone.done ? Date.now() : null;
        }
        nextStatus = project.status;
        if (nextStatus !== prevStatus) {
          project.history.push({
            at: Date.now(),
            from: prevStatus,
            to: nextStatus,
            by: role,
            note: str(args.note),
            // 置 review 这一刻，把当时的 report 文书 id 钉进历史，事后无法调换顺序
            reportId: nextStatus === 'review' && latestReport ? latestReport.id : null,
          });
        }
        project.updatedAt = Date.now();
        view = { id: project.id, status: project.status, progress: progressOf(project) };
      });

      if (nextStatus && nextStatus !== prevStatus) {
        await onStatusChanged(ctx, { projectId, from: prevStatus, to: nextStatus });
      }
      return { project: view };
    },
  ));

  // -- 奏疏：把要问用户的问题挂到项目看板 -------------------------------------
  ctx.tools.register(makeTool(
    'court_ask_user',
    '向用户提问（默认不阻塞：把问题挂到「奏疏」，自己写假设继续）。' +
      '只有确实无法继续时才传 blocking:true；全自动项目不要用这个工具。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      question: { type: 'string', required: true, description: '要问的问题，一句话说清。' },
      options: {
        type: 'array',
        description: '可选项（可选）；给出后界面会显示成按钮。',
        items: { type: 'string' },
      },
      context: { type: 'string', description: '给用户看的背景（可选）。' },
      blocking: {
        type: 'boolean',
        description: '是否真的卡住、必须等回答；默认 false（非阻塞，写假设继续）。',
      },
      assumption: {
        type: 'string',
        description: '非阻塞时你按什么假设继续（会写进项目 note，便于事后核对）。',
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        questionId: { type: 'string', required: true, description: '奏疏条目 id。' },
        status: { type: 'string', required: true, description: '项目当前状态。' },
        blocking: { type: 'boolean', required: true, description: '是否阻塞。' },
        duplicate: { type: 'boolean', required: true, description: '是否复用了同文已有问题。' },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const question = str(args.question).trim();
      if (!question) throw new Error('问题不能为空');

      const before = await read();
      const project0 = before.projects[projectId];
      if (!project0) throw new Error(`项目不存在：${projectId}`);
      if (project0.autoMode) throw new Error('本项目已开启全自动：不要问用户，自己按最优方案决定并把假设写进文书。');
      if (['done', 'archived'].includes(project0.status)) throw new Error('项目已结束，不能再发奏疏');

      const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
      const existing = (project0.questions || []).find((item) => (
        item.status === 'open' && normalize(item.question) === normalize(question)
      ));
      if (existing) {
        return {
          questionId: existing.id,
          status: project0.status,
          blocking: Boolean(existing.blocking),
          duplicate: true,
        };
      }

      const { role } = roleOf(before, project0, exec);
      if (!role) throw new Error('无法识别调用者角色：不能发奏疏');
      const blocking = args.blocking === true;
      const assumption = str(args.assumption).trim();
      const questionId = makeId('q');
      await update((state) => {
        const project = state.projects[projectId];
        const prev = project.status;
        project.questions.push({
          id: questionId,
          at: Date.now(),
          by: role || 'unknown',
          question,
          options: Array.isArray(args.options) ? args.options.map((o) => str(o)).filter(Boolean) : [],
          context: str(args.context),
          blocking,
          assumption,
          status: 'open',
        });
        if (blocking) {
          if (project.status !== 'blocked') project.statusBeforeBlocked = project.status;
          project.status = 'blocked';
          project.blockedReason = question.slice(0, 80);
          if (prev !== 'blocked') {
            project.history.push({
              at: Date.now(),
              from: prev,
              to: 'blocked',
              by: role || 'unknown',
              note: `奏疏（阻塞）：${question.slice(0, 80)}`,
              reportId: null,
            });
          }
        } else {
          project.lastNote = `待确认（不阻塞）：${question.slice(0, 80)}`
            + (assumption ? `；假设：${assumption.slice(0, 120)}` : '');
        }
        project.updatedAt = Date.now();
      });
      return {
        questionId,
        status: blocking ? 'blocked' : project0.status,
        blocking,
        duplicate: false,
      };
    },
  ));

  // -- 验收命令：开工前登记，宿主侧执行 -------------------------------------
  ctx.tools.register(makeTool(
    'court_set_checks',
    '登记本项目的验收命令（test/lint/build）。只允许开工前由架构师/项目经理/秘书设置；' +
      '执行或复核阶段不能改，防止工程师改验收标准。Windows 默认用 cmd（支持 &&）；' +
      '需要 PowerShell 语法时显式 shell:"pwsh" 或 shell:"powershell"。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      checks: {
        type: 'array',
        required: true,
        description: '验收命令列表，最多 10 条。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '短 id，如 test/lint/build。' },
            command: { type: 'string', required: true, description: '要执行的命令。' },
            shell: {
              type: 'string',
              description: 'auto（Windows=cmd，POSIX=bash）/ cmd / pwsh / powershell / bash。',
            },
            timeoutMs: { type: 'integer', description: '超时毫秒，默认 300000，范围 5s–15min。' },
          },
        },
      },
      allowUnproven: {
        type: 'boolean',
        description: '预跑失败也强行登记（只在确认是临时环境问题时用）。',
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        project: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '项目 id。' },
            checks: {
              type: 'array',
              required: true,
              description: '登记后的验收命令。',
              items: CHECK_SCHEMA,
            },
          },
        },
        preflight: {
          type: 'array',
          required: true,
          description: '每条命令的预跑结果。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true, description: '验收命令 id。' },
              ok: { type: 'boolean', required: true, description: '环境是否可用。' },
              kind: { type: 'string', required: true, description: 'ok/nonzero/slow/env/encoding。' },
              detail: { type: 'string', required: true, description: '一句话说明。' },
            },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (!canSetChecks(role, project.status)) {
        throw new Error(`角色 ${role || 'unknown'} 不能在 ${project.status} 阶段设置验收命令`);
      }
      const checks = normalizeChecks(args.checks, { strict: true });
      for (const shell of new Set(checks.map((check) => check.shell))) {
        await probeShell(shell);
      }
      // 登记即预跑：环境问题当场炸，代码没写完的红色不算问题。
      const cwd = str(project.workspace?.path);
      const preflight = [];
      if (cwd) {
        for (const check of checks) {
          preflight.push(await preflightCheck(check, cwd));
        }
        const broken = preflight.filter((item) => !item.ok);
        if (broken.length > 0 && args.allowUnproven !== true) {
          throw new Error(
            `验收命令预跑失败，未登记：${broken.map((item) => `${item.id}（${item.detail}）`).join('；')}。`
            + '先修命令或换 shell；确认是一次性环境问题，可以带 allowUnproven:true 强行登记。',
          );
        }
      }
      await update((current) => {
        const target = current.projects[projectId];
        target.checks = checks;
        target.updatedAt = Date.now();
      });
      return {
        project: { id: projectId, checks: checks.map(checkView) },
        preflight,
      };
    },
  ));

  // -- 工单：拆解、派活、回收 -----------------------------------------------
  ctx.tools.register(makeTool(
    'court_set_packages',
    '项目管理把契约拆成工单（≤30 条）。每张工单必须写清「只许改哪些文件」和「完成标准」；'
    + '两张工单若要改同一批文件，必须用 dependsOn 排出先后——这是并行不打架的唯一保证。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      packages: {
        type: 'array',
        required: true,
        description: '工单列表。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '短 id，如 k1。' },
            title: { type: 'string', required: true, description: '一句话说清做什么。' },
            goal: { type: 'string', description: '交付目标（可验收的那种）。' },
            files: {
              type: 'array',
              description: '只许改的路径（相对工作区，支持 src/api/**）。',
              items: { type: 'string' },
            },
            dod: {
              type: 'array',
              description: '完成标准，逐条可判定。',
              items: { type: 'string' },
            },
            dependsOn: {
              type: 'array',
              description: '依赖的工单 id（它们合入后本工单才能开工）。',
              items: { type: 'string' },
            },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        packages: {
          type: 'array',
          required: true,
          description: '落库后的工单。',
          items: { type: 'object', additionalProperties: true, properties: {} },
        },
        warnings: { type: 'array', required: true, description: '不挡派活但要注意的问题。', items: { type: 'string' } },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const { role } = roleOf(state, project, exec);
      if (role === 'executor') throw new Error('工程师不拆工单；按派给你的那张工单干');
      if (!['zhongshu', 'shangshu', 'secretary'].includes(role)) {
        throw new Error(`角色 ${role || 'unknown'} 不能拆工单`);
      }
      const list = (Array.isArray(args.packages) ? args.packages : []).slice(0, 30).map((pkg) => ({
        id: str(pkg?.id).trim(),
        title: str(pkg?.title).trim(),
        goal: str(pkg?.goal).trim(),
        files: (Array.isArray(pkg?.files) ? pkg.files : []).map((f) => str(f).trim()).filter(Boolean).slice(0, 60),
        dod: (Array.isArray(pkg?.dod) ? pkg.dod : []).map((d) => str(d).trim()).filter(Boolean).slice(0, 10),
        dependsOn: (Array.isArray(pkg?.dependsOn) ? pkg.dependsOn : []).map((d) => str(d).trim()).filter(Boolean),
        state: 'queued',
        assignee: '',
      }));
      const { errors, warnings } = validatePackages(list);
      if (errors.length > 0) {
        throw new Error(`工单不合格，未落库：\n- ${errors.join('\n- ')}`);
      }
      let saved = [];
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) throw new Error(`项目不存在：${projectId}`);
        target.packages = list;
        target.updatedAt = Date.now();
        saved = target.packages;
      });
      return {
        packages: saved.map((pkg) => ({
          id: pkg.id,
          title: pkg.title,
          files: pkg.files,
          dod: pkg.dod,
          dependsOn: pkg.dependsOn,
          state: pkg.state,
        })),
        warnings,
      };
    },
  ));

  ctx.tools.register(makeTool(
    'court_update_package',
    '推进一张工单的状态：doing（开工）→ ready（自检完，等合入）→ merged（项目经理/秘书合入）；'
    + '任何状态都可以置 blocked，但必须写原因。工程师只能动自己那张。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      packageId: { type: 'string', required: true, description: '工单 id。' },
      state: { type: 'string', required: true, description: 'queued/doing/ready/merged/blocked。' },
      note: { type: 'string', description: '说明；置 blocked 时必填。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        package: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '工单 id。' },
            state: { type: 'string', required: true, description: '新状态。' },
            next: { type: 'string', required: true, description: '下一个可开工的工单 id，没有则为空串。' },
          },
        },
      },
    },
    async (args, exec) => {
      const projectId = str(args.projectId);
      const packageId = str(args.packageId);
      const wanted = str(args.state);
      if (!PACKAGE_STATES.includes(wanted)) {
        throw new Error(`未知工单状态：${wanted}（可用：${PACKAGE_STATES.join('/')}）`);
      }
      const state = await read();
      const project = state.projects[projectId];
      if (!project) throw new Error(`项目不存在：${projectId}`);
      const pkg = project.packages.find((item) => item.id === packageId);
      if (!pkg) throw new Error(`工单不存在：${packageId}`);
      const { role } = roleOf(state, project, exec);
      if (wanted === 'merged' && !['shangshu', 'secretary'].includes(role)) {
        throw new Error('只有项目管理或秘书能把工单合入');
      }
      if (wanted === 'blocked' && !str(args.note).trim()) {
        throw new Error('置 blocked 必须写 note（卡在哪、缺什么）');
      }
      if (pkg.state === 'merged' && wanted !== 'merged' && role !== 'secretary') {
        throw new Error(`工单 ${packageId} 已合入；要返工先让秘书把它退回 queued`);
      }
      let next = '';
      await update((current) => {
        const target = current.projects[projectId];
        const item = target.packages.find((entry) => entry.id === packageId);
        if (!item) throw new Error(`工单不存在：${packageId}`);
        item.state = wanted;
        item.note = str(args.note);
        item.updatedAt = Date.now();
        if (wanted === 'doing') item.assignee = role || item.assignee;
        target.updatedAt = Date.now();
        next = nextPackage(target.packages)?.id ?? '';
      });
      return { package: { id: packageId, state: wanted, next } };
    },
  ));

  // -- 核验：文件指纹 + 验收命令，宿主侧执行 ---------------------------------
  ctx.tools.register(makeTool(
    'court_verify',
    '在项目工作区做一次独立核验：先跑登记过的验收命令（test/lint/build），再核对文件数、目录数、' +
      '相对开工基线的改动；默认不再返回逐文件哈希（需要时传 includeHashes=true）。' +
      '宿主侧执行，不受会话沙箱限制；评审复核时应当用它，而不是依赖工程师自述。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      checks: {
        type: 'array',
        description: '要跑的 check id；省略则跑项目里登记的全部 checks。',
        items: { type: 'string' },
      },
      includeHashes: { type: 'boolean', description: '是否返回逐文件 sha256，默认 false。' },
      mode: {
        type: 'string',
        description: 'smoke＝只跑第一条 check（几秒内给个信号）；full＝全部跑（默认）。',
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspace: { type: 'string', required: true, description: '工作区路径。' },
        files: { type: 'integer', required: true, description: '文件总数（已排除 node_modules/.git 等）。' },
        dirs: { type: 'integer', required: true, description: '目录总数。' },
        totalBytes: { type: 'integer', required: true, description: '总字节数。' },
        hashes: {
          type: 'array',
          required: true,
          description: '逐文件 sha256；includeHashes=false 时为空。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', required: true, description: '相对路径。' },
              bytes: { type: 'integer', required: true, description: '字节数。' },
              sha256: { type: 'string', required: true, description: 'sha256。' },
            },
          },
        },
        truncated: { type: 'boolean', required: true, description: '是否因数量上限被截断。' },
        changed: {
          type: 'array',
          required: true,
          description: '相对基线发生变化的文件（新增/修改/删除）。',
          items: { type: 'string' },
        },
        checks: {
          type: 'array',
          required: true,
          description: '本次验收命令的执行结果。',
          items: CHECK_RESULT_SCHEMA,
        },
        verification_id: { type: 'string', required: true, description: '本次验证 id；空串表示没跑 checks。' },
        ok: { type: 'boolean', required: true, description: '所有 check 是否通过；没跑 checks 时为 true。' },
        hint: { type: 'string', required: true, description: '失败诊断提示；空串表示无。' },
      },
    },
    async (args, exec) => {
      const state = await read();
      const project = state.projects[str(args.projectId)];
      if (!project) throw new Error(`项目不存在：${str(args.projectId)}`);
      if (!project.workspace || !project.workspace.path) throw new Error('项目还没有工作区');
      const { role } = roleOf(state, project, exec);
      if (!canVerify(role)) throw new Error(`角色 ${role || 'unknown'} 不能跑验收`);

      const checkIds = Array.isArray(args.checks)
        ? args.checks.map((id) => str(id).trim()).filter(Boolean)
        : [];
      // smoke：只跑第一条，几秒内给个「还能不能编译/跑起来」的信号；full 才全部跑。
      const smoke = str(args.mode).trim() === 'smoke';
      const smokeIds = smoke && checkIds.length === 0 && project.checks.length > 0
        ? [project.checks[0].id]
        : checkIds;
      let verification = null;
      if (smokeIds.length > 0) {
        verification = await runChecks(project, { checkIds: smokeIds, by: role || 'unknown' });
      } else if (!smoke && project.checks.length > 0) {
        verification = await runChecks(project, { checkIds, by: role || 'unknown' });
      }
      const report = await verifyWorkspace(
        project.workspace.path,
        await loadBaseline(project.id),
        { includeHashes: args.includeHashes === true },
      );

      if (verification && verification.id) {
        await update((current) => {
          const target = current.projects[project.id];
          if (!target) return;
          target.verifications.push(verification);
          target.verifications = target.verifications.slice(-10);
          target.lastVerificationId = verification.id;
          // 记账：跑一次验收就是一次成本，报价里的「验收次数」全靠它对照
          if (target.actual && typeof target.actual === 'object') target.actual.verifications += 1;
          target.updatedAt = Date.now();
        });
      }

      return {
        workspace: report.workspace,
        files: report.files,
        dirs: report.dirs,
        totalBytes: report.totalBytes,
        hashes: report.hashes,
        truncated: report.truncated,
        changed: report.changed,
        checks: verification ? summarizeChecks(verification) : [],
        verification_id: verification ? verification.id : '',
        ok: verification ? Boolean(verification.ok) : true,
        hint: checkHint(verification),
      };
    },
  ));

  // -- 交付 diff：给评审看真正的改动 ----------------------------------------
  ctx.tools.register(makeTool(
    'court_diff',
    '查看项目相对开工基线的 git diff（stat + 有界 patch）。工作区不是 git 仓库时会明确返回不可用，' +
      '此时请用 court_verify 的文件清单和哈希。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      maxBytes: { type: 'integer', description: 'patch 最多返回多少字节，默认 120000，上限 200000。' },
      paths: {
        type: 'array',
        description: '只看这些相对路径（可选，最多 20 个）。',
        items: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        available: { type: 'boolean', required: true, description: '是否能生成 diff。' },
        reason: { type: 'string', required: true, description: '不可用/失败原因。' },
        base: { type: 'string', required: true, description: '基线 commit。' },
        stat: { type: 'string', required: true, description: 'git diff --stat。' },
        patch: { type: 'string', required: true, description: 'unified diff，可能被截断。' },
        truncated: { type: 'boolean', required: true, description: 'patch 是否被截断。' },
        changed: { type: 'array', required: true, description: 'git status 里的变更文件。', items: { type: 'string' } },
        untracked: { type: 'array', required: true, description: '未跟踪文件。', items: { type: 'string' } },
      },
    },
    async (args, exec) => {
      const state = await read();
      const project = state.projects[str(args.projectId)];
      if (!project) throw new Error(`项目不存在：${str(args.projectId)}`);
      if (!project.workspace || !project.workspace.path) throw new Error('项目还没有工作区');
      const { role } = roleOf(state, project, exec);
      if (!canDiff(role)) throw new Error(`角色 ${role || 'unknown'} 不能查看项目 diff`);
      return gitDiff(project.workspace.path, project.baseline, {
        maxBytes: num(args.maxBytes, 120000),
        paths: Array.isArray(args.paths) ? args.paths : [],
      });
    },
  ));

  // -- 知识库检索 ----------------------------------------------------------
  ctx.tools.register(makeTool(
    'court_vault_search',
    '只读检索用户的「知识库」（LLM Wiki 知识库）。只有项目开启了「允许浏览知识库」时才能用。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
      query: { type: 'string', required: true, description: '关键词。' },
      limit: { type: 'integer', description: '最多返回几条，默认 5。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        scanned: { type: 'integer', required: true, description: '扫描了多少个文件。' },
        hits: {
          type: 'array',
          required: true,
          description: '命中片段。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', required: true, description: '文件路径。' },
              snippet: { type: 'string', required: true, description: '命中上下文。' },
            },
          },
        },
      },
    },
    async (args) => {
      const state = await read();
      const project = state.projects[str(args.projectId)];
      if (!project) throw new Error(`项目不存在：${str(args.projectId)}`);
      if (!project.vaultAccess) {
        throw new Error('这个项目没有开启「允许浏览知识库」：请让用户在项目详情里打开开关');
      }
      if (!str(state.settings.vaultPath)) {
        throw new Error('还没设置知识库根目录：请用户在「智库 → 交付出口」里填一个目录，再搜');
      }
      const result = await searchVault(
        state.settings.vaultPath,
        str(args.query),
        Math.min(10, Math.max(1, num(args.limit, 5))),
      );
      return { scanned: result.scanned, hits: result.hits };
    },
  ));

  // -------------------------------------------------------------------------
  // 公司级知识库（企业智库）：跨项目沉淀，注入立项与移交
  // -------------------------------------------------------------------------

  ctx.tools.register(makeTool(
    'court_kb_save',
    '往公司知识库写一条结论（跨项目复用）。'
    + '只收「以后还用得上」的：决策与理由、硬约定、踩过的坑、可复用做法、工具的真实用法、术语口径、客户偏好。'
    + '一次只写一条，标题要能独立看懂；出处会自动记下项目与文书。'
    + '项目内部的细节不要写进来——那是项目文书。',
    {
      kind: { type: 'string', description: `类型：${Object.entries(KB_KIND_LABEL).map(([k, v]) => `${k}=${v}`).join('、')}。默认 pattern。` },
      title: { type: 'string', required: true, description: '一句话结论，≤120 字，脱离上下文也能看懂。' },
      body: { type: 'string', description: '展开：现象/原因/证据/正确做法。≤8000 字。' },
      tags: { type: 'array', description: '标签，≤10 个（技术栈、模块名、业务词）。', items: { type: 'string' } },
      projectId: { type: 'string', description: '出自哪个项目（可空，但强烈建议填）。' },
      briefId: { type: 'string', description: '出自哪份文书（可空）。' },
      pinned: { type: 'boolean', description: '置顶：每次立项都会注入。只给真正的铁律用。' },
      confidence: { type: 'integer', description: '0 猜测 / 1 待验证 / 2 已验证（默认）/ 3 铁律。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        entry: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '知识条目 id。' },
            kind: { type: 'string', required: true, description: '类型。' },
            title: { type: 'string', required: true, description: '标题。' },
            tags: { type: 'array', required: true, description: '标签。', items: { type: 'string' } },
          },
        },
        stats: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            total: { type: 'integer', required: true, description: '库里总条数。' },
          },
        },
      },
    },
    async (args, exec) => {
      const state = await read();
      const role = roleOfCaller(state, exec);
      const projectId = str(args.projectId);
      const project = projectId ? state.projects[projectId] : null;
      if (projectId && !project) throw new Error(`项目不存在：${projectId}`);
      const now = Date.now();
      const entry = normalizeEntry(
        {
          id: makeId('kb'),
          kind: args.kind,
          title: args.title,
          body: args.body,
          tags: args.tags,
          projectId: projectId || null,
          projectName: project?.name || '',
          briefId: str(args.briefId) || null,
          source: role === 'secretary' ? 'secretary' : role || 'manual',
          pinned: args.pinned === true,
          confidence: args.confidence,
          createdAt: now,
          updatedAt: now,
          by: role || null,
        },
        now,
      );
      if (!entry.title || entry.title === '（无标题）') throw new Error('标题不能为空：一句话写清这条结论');
      if (entry.body.length < 8 && !entry.pinned) {
        throw new Error('正文太短：把现象、原因、正确做法写清楚，否则三个月后自己都看不懂');
      }
      let stats = null;
      await update((current) => {
        if (!current.kb) current.kb = { entries: [] };
        const exists = current.kb.entries.some((item) => item.title === entry.title);
        if (exists) throw new Error(`知识库里已有同名条目：${entry.title}（要改请用 court_kb_update）`);
        current.kb.entries.unshift(entry);
        if (current.kb.entries.length > KB_MAX_ENTRIES) current.kb.entries.length = KB_MAX_ENTRIES;
        stats = kbStats(current.kb.entries);
      });
      return { entry: { id: entry.id, kind: entry.kind, title: entry.title, tags: entry.tags }, stats };
    },
  ));

  ctx.tools.register(makeTool(
    'court_kb_search',
    '查公司知识库：立项前先查一遍，别重新踩坑。按标题/标签/正文模糊匹配，返回最相关的若干条。',
    {
      query: { type: 'string', description: '关键词（技术栈、模块名、报错片段都行）。空则按热度返回。' },
      kind: { type: 'string', description: '只看某类（decision/constraint/pitfall/pattern/tool/glossary/client）。' },
      tag: { type: 'string', description: '只看带某个标签的。' },
      limit: { type: 'integer', description: '条数，默认 8，最多 30。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true, description: '库里总条数。' },
        hits: {
          type: 'array',
          required: true,
          description: '命中的条目。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true, description: '条目 id。' },
              kind: { type: 'string', required: true, description: '类型。' },
              title: { type: 'string', required: true, description: '标题。' },
              body: { type: 'string', required: true, description: '正文（可能截断）。' },
              tags: { type: 'array', required: true, description: '标签。', items: { type: 'string' } },
              from: { type: 'string', required: true, description: '出处项目名。' },
              pinned: { type: 'boolean', required: true, description: '是否置顶。' },
            },
          },
        },
      },
    },
    async (args) => {
      const state = await read();
      const entries = state.kb?.entries || [];
      const limit = Math.min(30, Math.max(1, num(args.limit, 8)));
      const hits = searchEntries(entries, str(args.query), {
        kind: str(args.kind) || null,
        tag: str(args.tag) || null,
        limit,
      });
      return {
        total: entries.length,
        hits: hits.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          title: entry.title,
          body: entry.body.length > 1200 ? `${entry.body.slice(0, 1200)}…` : entry.body,
          tags: entry.tags,
          from: entry.projectName || entry.projectId || '未记项目',
          pinned: entry.pinned,
        })),
      };
    },
  ));

  ctx.tools.register(makeTool(
    'court_kb_digest',
    '从项目里提炼知识库候选条目（只读，不入库）。'
    + '把项目的约定、坑、技术栈、交付说明里的编号条目拆成候选，交给用户或秘书挑：'
    + '挑中的用 court_kb_save 正式入库。结项时跑一次，公司记忆才不会断线。',
    {
      projectId: { type: 'string', required: true, description: '项目 id。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        candidates: {
          type: 'array',
          required: true,
          description: '候选条目（未入库）。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, description: '建议类型。' },
              title: { type: 'string', required: true, description: '建议标题。' },
              body: { type: 'string', required: true, description: '建议正文（可能较长）。' },
              tags: { type: 'array', required: true, description: '建议标签。', items: { type: 'string' } },
            },
          },
        },
      },
    },
    async (args) => {
      const state = await read();
      const project = state.projects[str(args.projectId)];
      if (!project) throw new Error(`项目不存在：${str(args.projectId)}`);
      const candidates = digestCandidates(project, state.kb?.entries || []);
      return {
        candidates: candidates.map((entry) => ({
          kind: entry.kind,
          title: entry.title,
          body: entry.body.length > 800 ? `${entry.body.slice(0, 800)}…` : entry.body,
          tags: entry.tags,
        })),
      };
    },
  ));

  ctx.tools.register(makeTool(
    'court_kb_update',
    '改知识库条目：置顶/取消置顶、调置信度、改标题正文标签、删除。删除只有秘书或用户能做。',
    {
      id: { type: 'string', required: true, description: '条目 id。' },
      pinned: { type: 'boolean', description: '置顶开关。' },
      confidence: { type: 'integer', description: '0–3。' },
      title: { type: 'string', description: '新标题。' },
      body: { type: 'string', description: '新正文。' },
      tags: { type: 'array', description: '新标签（整体替换）。', items: { type: 'string' } },
      remove: { type: 'boolean', description: '设为 true 则删除（仅秘书或用户）。' },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        removed: { type: 'boolean', required: true, description: '是否已删除。' },
        entry: {
          type: 'object',
          required: true,
          description: '更新后的条目（删除时为空对象）。',
          properties: {
            id: { type: 'string', required: true, description: 'id。' },
            kind: { type: 'string', required: true, description: '类型。' },
            title: { type: 'string', required: true, description: '标题。' },
            pinned: { type: 'boolean', required: true, description: '置顶。' },
            confidence: { type: 'integer', required: true, description: '置信度。' },
          },
        },
        total: { type: 'integer', required: true, description: '库里总条数。' },
      },
    },
    async (args, exec) => {
      const id = str(args.id);
      const state = await read();
      const role = roleOfCaller(state, exec);
      if (args.remove === true && !['secretary', 'user'].includes(role)) {
        throw new Error('删除知识条目只有秘书或用户能做：库是公司资产，工程师不删别人的结论');
      }
      let view = {};
      let removed = false;
      let total = 0;
      await update((current) => {
        const entries = current.kb?.entries || [];
        const index = entries.findIndex((entry) => entry.id === id);
        if (index < 0) throw new Error(`知识条目不存在：${id}`);
        if (args.remove === true) {
          entries.splice(index, 1);
          removed = true;
        } else {
          const target = entries[index];
          if (typeof args.pinned === 'boolean') target.pinned = args.pinned;
          if (args.confidence !== undefined) target.confidence = Math.max(0, Math.min(3, num(args.confidence, target.confidence)));
          if (str(args.title)) target.title = str(args.title).slice(0, 120);
          if (str(args.body)) target.body = str(args.body).slice(0, KB_MAX_BODY);
          if (Array.isArray(args.tags)) target.tags = normalizeEntry({ ...target, tags: args.tags }).tags;
          target.updatedAt = Date.now();
          view = target;
        }
        total = entries.length;
      });
      return {
        removed,
        entry: removed
          ? {}
          : { id: view.id, kind: view.kind, title: view.title, pinned: view.pinned, confidence: view.confidence },
        total,
      };
    },
  ));
}
