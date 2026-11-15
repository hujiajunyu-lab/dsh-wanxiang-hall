/**
 * 万象工阁（court）宿主半侧 —— HTTP 层
 *
 * 约束：这个包装在 DSH profile 里，无法 import `@deepseek-ai/*`，因此零依赖。
 * 状态在 store.js，agent 工具在 tools.js；三者共用同一个模块级状态。
 */

import * as courtStore from './store.js';
import {
  DEFAULT_MILESTONES,
  decorate,
  makeId,
  normalizeProject,
  num,
  quadrantOf,
  read,
  readProblem,
  snapshot,
  str,
  update,
  stateFilePath,
} from './store.js';
import { SHAPES } from './auth.js';
import { AREA, BRAND, roleLabel as brandRole } from './brand.js';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onStatusChanged, performHandoff, talkToSecretary } from './handoff.js';
import { openCourtSession, promptSession, service } from './sessions.js';
import { diffSnapshot, loadBaseline, removeBaseline } from './snapshot.js';
import { inspectVault, validateVaultRoot, writeEntry } from './vault.js';
import { normalizeChecks, probeShell } from './checks.js';
import {
  KB_KINDS,
  KB_KIND_LABEL,
  KB_MAX_BODY,
  KB_MAX_ENTRIES,
  digestCandidates,
  kbStats,
  normalizeEntry,
  searchEntries,
} from './kb.js';
import {
  MAX_NUDGES,
  STAGE_ROLE,
  appetiteBreach,
  appetiteOf,
  appetiteText,
  describeHealth,
  healthOf,
  heartbeatPatch,
  nextAction,
  stampOf,
} from './activity.js';

const API_PREFIX = '/court';
const MAX_BODY_BYTES = 512 * 1024;

/** 接口版本：客户端用它判断宿主半侧是不是旧版（旧版不会带这个字段）。 */
const API_VERSION = 20;

/** 巡夜：每 10 分钟扫一次；阈值在 activity.js（15 分钟有动作 / 90 分钟算空转）。 */
const WATCH_INTERVAL_MS = 10 * 60 * 1000;

/** apply() 拿到的宿主 ctx，供 /secretary 与 /handoff 路由做会话编排。 */
let hostCtx = null;

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

/**
 * 本地 HTTP 防跨站：浏览器从别的页面 POST 到 127.0.0.1 时，Origin 不是本机，
 * 或 Sec-Fetch-Site 是 cross-site/same-site；JSON content-type 也会被浏览器预检。
 * 这不是完整的认证，但能挡掉最常见的本地 CSRF / 提示注入。
 */
function assertSameOrigin(req, { allowBinary = false } = {}) {
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') {
    throw Object.assign(new Error('拒绝跨站请求'), { status: 403 });
  }
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      throw Object.assign(new Error('Origin 不合法'), { status: 403 });
    }
    if (originHost !== req.headers.host) {
      throw Object.assign(new Error('拒绝跨站请求'), { status: 403 });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    const ok = contentType.startsWith('application/json')
      || (allowBinary && contentType.startsWith('application/octet-stream'));
    if (!ok) {
      throw Object.assign(new Error(allowBinary ? '只接受 application/json 或 application/octet-stream' : '只接受 application/json'), { status: 415 });
    }
  }
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

/** 用户从输入框粘进来的路径常带成对引号；入库前统一去掉，避免引号被当成路径的一部分。 */
function cleanWorkspacePath(value) {
  return str(value)
    .trim()
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim();
}

async function createProject(body) {
  const name = str(body?.name).trim();
  if (!name) throw Object.assign(new Error('项目名不能为空'), { status: 400 });
  const now = Date.now();
  const id = makeId('p');
  const workspacePath = cleanWorkspacePath(body?.workspacePath);
  const milestones = Array.isArray(body?.milestones) && body.milestones.length > 0
    ? body.milestones
    : DEFAULT_MILESTONES;
  const project = normalizeProject(id, {
    name,
    description: str(body?.description).trim(),
    status: 'draft',
    shape: SHAPES.includes(str(body?.shape))
      ? str(body?.shape)
      : (str(body?.mode) === 'full' ? 'crew' : 'squad'),
    vaultAccess: body?.vaultAccess !== false,
    priority: { important: body?.important === true, urgent: body?.urgent === true },
    tags: Array.isArray(body?.tags) ? body.tags : [],
    workspace: workspacePath ? { path: workspacePath, id: '' } : null,
    createdAt: now,
    updatedAt: now,
    milestones: milestones.map((m, index) => ({
      id: `m${index + 1}`,
      title: str(m?.title, `里程碑 ${index + 1}`),
      weight: Math.max(1, num(m?.weight, 10)),
      done: false,
    })),
  });
  await update((state) => {
    state.projects[id] = project;
  });
  return decorate(project);
}

async function patchProject(body) {
  const id = str(body?.id);
  const patch = body?.patch && typeof body.patch === 'object' ? body.patch : {};
  let result = null;
  let prevStatus = null;
  let nextStatus = null;
  await update((state) => {
    const project = state.projects[id];
    if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });

    if (typeof patch.name === 'string' && patch.name.trim()) project.name = patch.name.trim();
    if (typeof patch.description === 'string') project.description = patch.description;
    if (patch.blockedReason === null || typeof patch.blockedReason === 'string') {
      project.blockedReason = patch.blockedReason || null;
    }
    if (typeof patch.note === 'string') project.lastNote = patch.note || null;
    if (typeof patch.vaultAccess === 'boolean') project.vaultAccess = patch.vaultAccess;
    if (typeof patch.autoMode === 'boolean') project.autoMode = patch.autoMode;
    if (typeof patch.status === 'string' && patch.status) {
      // 直接校验并赋值：不依赖 store 里的 STATUSES（旧模块实例可能还没有 paused）。
      const allowed = new Set(['draft', 'zhongshu', 'menxia', 'shangshu', 'executing', 'review', 'done', 'archived', 'blocked', 'paused']);
      if (!allowed.has(patch.status)) throw Object.assign(new Error(`未知状态：${patch.status}`), { status: 400 });
      prevStatus = project.status;
      project.status = patch.status;
      nextStatus = project.status;
      // 暂停：记住停之前在哪一阶段，恢复时回到那里；恢复本身不记 pausedFrom。
      if (nextStatus === 'paused' && prevStatus !== 'paused') {
        project.pausedFrom = prevStatus === 'done' || prevStatus === 'archived' ? null : prevStatus;
        project.pausedAt = Date.now();
      } else if (prevStatus === 'paused' && nextStatus !== 'paused') {
        project.pausedFrom = null;
        project.pausedAt = null;
      }
      if (patch.status !== 'blocked') project.blockedReason = null;
      if (nextStatus !== prevStatus) {
        project.history.push({
          at: Date.now(),
          from: prevStatus,
          to: nextStatus,
          by: 'user',
          note: str(patch.note),
          reportId: null,
        });
      }
    }
    if (typeof patch.rounds === 'number') project.rounds = Math.max(0, patch.rounds);
    if (patch.workspace && typeof patch.workspace === 'object') {
      project.workspace = { id: str(patch.workspace.id), path: cleanWorkspacePath(patch.workspace.path) };
    }
    if (patch.departments && typeof patch.departments === 'object') {
      for (const key of Object.keys(project.departments)) {
        const incoming = patch.departments[key];
        if (incoming && typeof incoming === 'object') {
          project.departments[key] = {
            ...project.departments[key],
            sessionId: incoming.sessionId === null
              ? null
              : str(incoming.sessionId, project.departments[key].sessionId),
            state: str(incoming.state, project.departments[key].state),
            note: str(incoming.note, project.departments[key].note),
          };
        }
      }
    }
    if (Array.isArray(patch.milestones)) {
      project.milestones = patch.milestones.map((m, index) => ({
        id: str(m?.id, `m${index + 1}`),
        title: str(m?.title, `里程碑 ${index + 1}`),
        weight: Math.max(1, num(m?.weight, 10)),
        done: Boolean(m?.done),
        doneAt: m?.doneAt ?? null,
      }));
    }
    project.updatedAt = Date.now();
    result = decorate(project);
  });

  if (hostCtx && nextStatus && nextStatus !== prevStatus) {
    await onStatusChanged(hostCtx, { projectId: id, from: prevStatus, to: nextStatus });
  }
  return result;
}

async function toggleMilestone(body) {
  const projectId = str(body?.projectId);
  const milestoneId = str(body?.milestoneId);
  let result = null;
  await update((state) => {
    const project = state.projects[projectId];
    if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
    const milestone = project.milestones.find((m) => m.id === milestoneId);
    if (!milestone) throw Object.assign(new Error('里程碑不存在'), { status: 404 });
    milestone.done = Boolean(body?.done);
    milestone.doneAt = milestone.done ? Date.now() : null;
    project.updatedAt = Date.now();
    result = decorate(project);
  });
  return result;
}

async function deleteProject(body) {
  const id = str(body?.id);
  const state = await read();
  const project = state.projects[id];
  if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });

  const sessionIds = [
    ...Object.values(project.departments).map((dept) => dept.sessionId),
    ...(project.retiredSessions || []),
  ].filter(Boolean);

  const cleanup = body?.archiveSessions === false
    ? { archived: [], failed: [] }
    : await archiveSessions({ sessionIds });

  const courtDir = path.dirname(stateFilePath());
  const cleaned = [];
  async function removeMatching(dir, matches) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!matches.some((test) => test(entry.name))) continue;
      const target = path.join(dir, entry.name);
      try {
        await fs.unlink(target);
        cleaned.push(target);
      } catch {
        /* 删不掉就留给用户手工处理 */
      }
    }
  }

  // 只清理由万象工阁自己产生的文件：基线快照与验收日志。
  // 工作区代码、LLM Wiki 知识页、DSH 会话都不在这里删。
  await removeMatching(path.join(courtDir, 'baselines'), [
    (name) => name === `${id}.json`,
    (name) => name.startsWith(`${id}-`),
  ]);
  const verificationIds = (project.verifications || []).map((item) => String(item.id || '')).filter(Boolean);
  await removeMatching(path.join(courtDir, 'verifications'), [
    (name) => verificationIds.some((verificationId) => name.startsWith(`${verificationId}-`)),
  ]);

  await update((current) => {
    delete current.projects[id];
    for (const [entryId, entry] of Object.entries(current.vault)) {
      if (entry && entry.projectId === id) delete current.vault[entryId];
    }
  });
  await removeBaseline(id);

  return {
    ok: true,
    archived: cleanup.archived.length,
    failed: cleanup.failed.length,
    cleaned,
    kept: {
      workspace: project.workspace ? project.workspace.path : null,
      wiki: 'LLM Wiki 页面不删；需要时在 LLM Wiki 里单独处理。',
    },
  };
}

async function clearJump() {
  await update((state) => {
    state.pendingJump = null;
  });
  return { ok: true };
}

/** 回答一条奏疏：写回项目，并叫醒提问的那个会话。 */
async function answerQuestion(body) {
  const projectId = str(body.projectId);
  const questionId = str(body.questionId);
  const answer = str(body.answer).trim();
  if (!answer) throw Object.assign(new Error('回答不能为空'), { status: 400 });

  const state = await read();
  const project = state.projects[projectId];
  if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
  const question = (project.questions || []).find((q) => q.id === questionId && q.status === 'open');
  if (!question) throw Object.assign(new Error('这条奏疏已经处理过了'), { status: 400 });

  const role = question.by;
  const sessionId = role === 'secretary'
    ? state.settings.secretarySessionId
    : (project.departments[role] && project.departments[role].sessionId) || null;

  await update((current) => {
    const target = current.projects[projectId];
    const item = target.questions.find((q) => q.id === questionId);
    if (item) {
      item.status = 'answered';
      item.answer = answer;
      item.answeredAt = Date.now();
    }
    const stillOpen = target.questions.some((q) => q.status === 'open');
    if (!stillOpen && target.status === 'blocked') {
      const next = target.statusBeforeBlocked || 'zhongshu';
      target.history.push({
        at: Date.now(),
        from: 'blocked',
        to: next,
        by: 'user',
        note: '奏疏已答复，解除阻塞',
        reportId: null,
      });
      target.status = next;
      target.statusBeforeBlocked = null;
      target.blockedReason = null;
    }
    target.updatedAt = Date.now();
  });

  if (sessionId && hostCtx) {
    try {
      await promptSession(
        hostCtx,
        sessionId,
        `【万象工阁 · 奏疏答复】\n项目「${project.name}」的问题：${question.question}\n用户回答：${answer}\n请据此继续，不要重复追问同一件事。`,
      );
    } catch (error) {
      console.warn('[court] 奏疏答复投递失败：', error?.message ?? error);
    }
  }

  return { answered: true, sessionId, warning: sessionId ? '' : '该角色没有活跃会话，答复已记录但不会自动继续' };
}

// ---------------------------------------------------------------------------
// 会话清理（批量归档）
// ---------------------------------------------------------------------------

const ROLE_TITLE = {
  zhongshu: brandRole('zhongshu'),
  menxia: brandRole('menxia'),
  shangshu: brandRole('shangshu'),
  executor: brandRole('executor'),
};

function sessionRows(state) {
  const rows = [];
  if (state.settings.secretarySessionId) {
    rows.push({
      sessionId: state.settings.secretarySessionId,
      title: AREA.secretary,
      role: 'secretary',
      projectId: null,
      projectName: '',
    });
  }
  for (const project of Object.values(state.projects)) {
    for (const [role, dept] of Object.entries(project.departments)) {
      if (!dept.sessionId) continue;
      rows.push({
        sessionId: dept.sessionId,
        title: `${project.name} · ${brandRole(role, project.shape)}`,
        role,
        projectId: project.id,
        projectName: project.name,
      });
    }
    for (const sessionId of project.retiredSessions || []) {
      rows.push({
        sessionId,
        title: `${project.name} · 历史会话`,
        role: 'retired',
        projectId: project.id,
        projectName: project.name,
      });
    }
  }
  return rows;
}

async function archiveSessions(body) {
  const ids = Array.isArray(body?.sessionIds) ? body.sessionIds.filter((id) => typeof id === 'string') : [];
  if (ids.length === 0) return { archived: [], failed: [] };

  const controller = hostCtx && typeof hostCtx.get === 'function'
    ? hostCtx.get('workspaceController')
    : undefined;

  const archived = [];
  const failed = [];

  for (const sessionId of ids) {
    try {
      if (!controller || typeof controller.archiveSession !== 'function') {
        throw new Error('workspaceController 未挂载，无法归档');
      }
      await controller.archiveSession({ sessionId, stopActivity: true });
      archived.push(sessionId);
    } catch (error) {
      failed.push({ sessionId, message: error?.message ?? String(error) });
    }
  }

  if (archived.length > 0) {
    await update((state) => {
      const gone = new Set(archived);
      for (const project of Object.values(state.projects)) {
        for (const dept of Object.values(project.departments)) {
          if (dept.sessionId && gone.has(dept.sessionId)) dept.sessionId = null;
        }
        if (Array.isArray(project.retiredSessions)) {
          project.retiredSessions = project.retiredSessions.filter((id) => !gone.has(id));
        }
      }
      if (state.settings.secretarySessionId && gone.has(state.settings.secretarySessionId)) {
        state.settings.secretarySessionId = null;
      }
    });
  }

  return { archived, failed };
}

// ---------------------------------------------------------------------------
// 接单台入口：确保存在 / 换一个
// ---------------------------------------------------------------------------

/** 归档过的秘书会话投递会被判 blocked；跳转/投递前顺手解档，失败不阻断。 */
async function unarchiveQuietly(ctx, sessionId) {
  const registry = ctx ? service(ctx, 'workspaceRegistry') : null;
  if (!registry || typeof registry.unarchiveSession !== 'function') return false;
  try {
    await registry.unarchiveSession(sessionId);
    return true;
  } catch {
    return false;
  }
}

/** 有就复用（顺手解档），没有就按 court-secretary 预设开一个；不投递任何消息。 */
async function ensureSecretarySession(ctx) {
  const state = await read();
  const courtWorkspace = state.settings.courtWorkspace;
  if (!courtWorkspace) throw Object.assign(new Error('万象工阁工作区未配置'), { status: 400 });

  const existing = state.settings.secretarySessionId || null;
  if (existing) {
    await unarchiveQuietly(ctx, existing);
    return { sessionId: existing, created: false };
  }

  const created = await openCourtSession(ctx, {
    preset: 'court-secretary',
    dirPath: courtWorkspace,
    title: '万象工阁',
    sessionTitle: '接单台',
  });
  await update((current) => {
    current.settings.secretarySessionId = created;
  });
  return { sessionId: created, created: true };
}

/** 归档当前接单台（可恢复），再开一个新的。 */
async function resetSecretarySession(ctx) {
  const state = await read();
  const previous = state.settings.secretarySessionId || null;

  if (previous) {
    const controller = service(ctx, 'workspaceController');
    try {
      if (!controller || typeof controller.archiveSession !== 'function') {
        throw new Error('workspaceController 未挂载，无法归档');
      }
      await controller.archiveSession({ sessionId: previous, stopActivity: true });
    } catch (error) {
      // 归档失败不阻断「换一个」：至少把引用切走，旧会话留给会话清理。
      console.warn('[court] 旧秘书会话归档失败：', error?.message ?? error);
    }
    await update((current) => {
      if (current.settings.secretarySessionId === previous) current.settings.secretarySessionId = null;
    });
  }

  const next = await ensureSecretarySession(ctx);
  return { sessionId: next.sessionId, previous, created: next.created };
}

// ---------------------------------------------------------------------------
// 知识库
// ---------------------------------------------------------------------------

async function intakeVault(body) {
  const projectId = str(body.projectId);
  const state = await read();
  const project = state.projects[projectId];
  if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });

  const vaultPath = str(body.vaultPath) || state.settings.vaultPath;
  if (!vaultPath) {
    throw Object.assign(new Error('还没设置知识库根目录：先在「智库 → 交付出口」填一个目录，再收进知识库'), { status: 400 });
  }
  const baseline = await loadBaseline(projectId);
  let diff = project.deliveryDiff || null;
  if (!diff && baseline && project.workspace && project.workspace.path) {
    try {
      diff = await diffSnapshot(project.workspace.path, baseline);
    } catch (error) {
      console.warn('[court] 入库前对比失败：', error?.message ?? error);
    }
  }

  const written = await writeEntry(vaultPath, project, diff);
  const entryId = makeId('v');
  const primary = written.primary || '';
  const filename = primary ? path.basename(primary) : '';
  const paths = (written.files || []).map((file) => file.path);

  await update((current) => {
    const target = current.projects[projectId];
    if (target) {
      target.vaultEntry = {
        path: primary,
        at: Date.now(),
        filename,
        paths,
        root: written.root,
      };
      target.updatedAt = Date.now();
    }
    // 配置的旧路径能自动纠正时，顺手把 settings 修好，避免下次再找错。
    if (written.root) current.settings.vaultPath = written.root;
    current.vault[entryId] = {
      id: entryId,
      projectId,
      title: project.name,
      preview: str(project.description).slice(0, 120),
      path: primary,
      paths,
      root: written.root,
      savedAt: Date.now(),
      syncedAt: Date.now(),
    };
  });

  const status = await inspectVault(written.root, project).catch(() => null);
  return {
    path: primary,
    root: written.root,
    resolved: written.resolved,
    files: written.files,
    status,
  };
}

async function vaultStatus(body) {
  const projectId = str(body.projectId);
  const state = await read();
  const project = state.projects[projectId];
  if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
  const vaultPath = str(body.vaultPath) || state.settings.vaultPath;
  if (!vaultPath) {
    return { root: '', rootAvailable: false, synced: 0, note: '还没设置知识库根目录' };
  }
  return inspectVault(vaultPath, project);
}

// ---------------------------------------------------------------------------
// 项目参考：用户从已有会话里挑出来的上下文
// ---------------------------------------------------------------------------

const REFERENCE_ITEM_CHARS = 4000;
const REFERENCE_TOTAL_CHARS = 60000;
const REFERENCE_CONTEXT_CHARS = 6000;

/**
 * 读一次会话的聊天记录（只取用户与 AI 的文字，跳过工具/系统消息）。
 * 用 sessionController.inspect：不需要激活 Agent，热会话和冷会话都能读。
 */
async function readSessionMessages(sessionId) {
  if (!sessionId) throw Object.assign(new Error('sessionId 不能为空'), { status: 400 });
  const controller = hostCtx ? service(hostCtx, 'sessionController') : null;
  if (!controller || typeof controller.inspect !== 'function') {
    throw Object.assign(new Error('sessionController 未就绪，无法读取会话记录'), { status: 503 });
  }
  const inspection = await controller.inspect(sessionId);
  const events = Array.isArray(inspection && inspection.events) ? inspection.events : [];
  const messages = [];
  const types = new Map();
  let sample = null;
  for (const event of events) {
    if (!event) continue;
    const type = String(event.type || '(none)');
    types.set(type, (types.get(type) || 0) + 1);
    if (type === 'assistant/message' && sample === null) {
      const data = event.data;
      sample = {
        dataType: typeof data,
        keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 12) : null,
        role: data && data.role,
        contentType: data && data.content !== undefined ? typeof data.content : 'undefined',
        blocks: Array.isArray(data && data.content) ? data.content.slice(0, 4).map((block) => (block && block.type) || typeof block) : null,
      };
    }
    if (type !== 'user/message' && type !== 'assistant/message') continue;
    // 助手消息把正文放在 data.message 里（user/message 直接放 data）。
    const data = event.data || {};
    const payload = data && data.message && typeof data.message === 'object' ? data.message : data;
    // 跳过宿主注入的噪音：每轮的时间/运行时上下文、模型切换提示。
    const sourceKind = payload && payload.source ? payload.source.kind : undefined;
    if (sourceKind === 'runtime-context' || sourceKind === 'model-selection') continue;
    const content = Array.isArray(payload && payload.content) ? payload.content : [];
    const raw = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();
    // 去掉宿主附加的 <system-reminder> 段，只留真正的聊天内容。
    const text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (!text) continue;
    // 宿主每轮注入的时间/运行时上下文不是「聊天记录」，别让用户挑到它。
    if (/^(Time sampled while preparing|Current runtime context\.|\[model changed:)/.test(text)) continue;
    messages.push({
      seq: num(event.seq),
      role: event.type === 'user/message' ? 'user' : 'assistant',
      at: num(event.time),
      text: text.slice(0, REFERENCE_ITEM_CHARS),
    });
  }
  return {
    messages: messages.slice(-200),
    types: [...types.entries()].sort((a, b) => b[1] - a[1]),
    sample,
  };
}

/** 把客户端勾选的消息收成一条项目参考。 */
async function addReference(body) {
  const projectId = str(body.projectId);
  const sessionId = str(body.sessionId);
  const sessionLabel = str(body.sessionLabel, '会话') || '会话';
  const kind = body.kind === 'session' ? 'session' : 'messages';
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .slice(0, 200)
    .map((item) => ({
      role: str(item && item.role) === 'assistant' ? 'assistant' : 'user',
      at: num(item && item.at),
      text: str(item && item.text).slice(0, REFERENCE_ITEM_CHARS),
    }))
    .filter((item) => item.text.trim());
  if (items.length === 0) throw Object.assign(new Error('没有选中任何消息'), { status: 400 });
  const total = items.reduce((sum, item) => sum + item.text.length, 0);
  if (total > REFERENCE_TOTAL_CHARS) {
    throw Object.assign(new Error(`选中的内容太多（${total} 字），一次最多 ${REFERENCE_TOTAL_CHARS} 字`), { status: 400 });
  }

  const reference = {
    id: makeId('r'),
    sessionId,
    sessionLabel,
    kind,
    items,
    createdAt: Date.now(),
    createdBy: 'user',
  };
  let result = null;
  await update((state) => {
    const project = state.projects[projectId];
    if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
    if (!Array.isArray(project.references)) project.references = [];
    project.references.push(reference);
    if (project.references.length > 30) project.references = project.references.slice(-30);
    project.updatedAt = Date.now();
    result = decorate(project);
  });
  return { project: result, reference };
}

async function removeReference(body) {
  const projectId = str(body.projectId);
  const referenceId = str(body.referenceId);
  let result = null;
  await update((state) => {
    const project = state.projects[projectId];
    if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
    project.references = project.references.filter((reference) => reference.id !== referenceId);
    project.updatedAt = Date.now();
    result = decorate(project);
  });
  return { project: result };
}

/** 项目附件目录：court/attachments/<projectId>/ */
function attachmentDir(projectId) {
  return path.join(path.dirname(stateFilePath()), 'attachments', projectId);
}

/** 文件名只留安全字符，避免 ../ 或非法字符写穿目录。 */
function safeFileName(raw) {
  const base = str(raw).split(/[\\/]/).pop() || 'file';
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'file';
}

const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;

async function readBodyBytes(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('附件过大（单文件上限 40MB）'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 立项时拖进来的文件落到项目目录，并把元数据写进项目。 */
async function saveAttachment(req, url) {
  const projectId = str(url.searchParams.get('projectId'));
  const name = safeFileName(url.searchParams.get('name'));
  const state = await read();
  if (!state.projects[projectId]) throw Object.assign(new Error('项目不存在'), { status: 404 });

  const bytes = await readBodyBytes(req, MAX_ATTACHMENT_BYTES);
  if (bytes.length === 0) throw Object.assign(new Error('空文件'), { status: 400 });

  const id = makeId('a');
  const dir = attachmentDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${id}-${name}`);
  await fs.writeFile(target, bytes);

  const attachment = { id, name, bytes: bytes.length, path: target, at: Date.now() };
  let result = null;
  await update((current) => {
    const project = current.projects[projectId];
    if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
    if (!Array.isArray(project.attachments)) project.attachments = [];
    project.attachments.push(attachment);
    if (project.attachments.length > 40) project.attachments = project.attachments.slice(-40);
    project.updatedAt = Date.now();
    result = decorate(project);
  });
  return { project: result, attachment };
}

async function deleteAttachment(body) {
  const projectId = str(body.projectId);
  const attachmentId = str(body.attachmentId);
  let removed = null;
  let result = null;
  await update((state) => {
    const project = state.projects[projectId];
    if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
    const list = Array.isArray(project.attachments) ? project.attachments : [];
    const target = list.find((attachment) => attachment.id === attachmentId);
    if (!target) return;
    removed = target;
    project.attachments = list.filter((attachment) => attachment.id !== attachmentId);
    project.updatedAt = Date.now();
    result = decorate(project);
  });
  if (removed) {
    try {
      await fs.unlink(removed.path);
    } catch {
      /* 文件已经不在了就算了 */
    }
  }
  return { project: result, removed: Boolean(removed) };
}

/**
 * 同步拿当前状态。
 *
 * 正常路径是 store.js 的内存单例（`currentState()`）；提示词段是同步接口，
 * 只能这样读。热重载时宿主可能把本文件换到新代、而 `./store.js` 仍是旧代
 * （旧代没有 `currentState`），所以这里带一个读磁盘的兜底：状态每次 update
 * 都已落盘，用 mtime 判断要不要重读，代价只有一次 stat。
 */
let fallbackState = null;
let fallbackMtime = -1;

function stateSync() {
  if (typeof courtStore.currentState === 'function') {
    const value = courtStore.currentState();
    if (value) return value;
  }
  try {
    const file = path.join(os.homedir(), '.dsh', 'court', 'court.json');
    const mtime = statSync(file).mtimeMs;
    if (mtime !== fallbackMtime) {
      fallbackState = JSON.parse(readFileSync(file, 'utf8'));
      fallbackMtime = mtime;
    }
  } catch {
    /* 还没有状态文件：当作没有项目 */
  }
  return fallbackState;
}

/**
 * 这个会话属于哪个项目？（岗位/工程师的会话，以及已退役的旧会话）
 * 接单台是跨项目的，不在这里注入项目参考 —— 她按需用 court_get_project 读。
 */
function projectOfSession(sessionId) {
  const state = stateSync();
  if (!state || !state.projects || !sessionId) return null;
  // 承接（court_fork_project）会让一个会话同时挂在几个项目上：取最近动过的那个，
  // 这样注入的是「这一轮」的项目参考，而不是上一轮的。
  let found = null;
  for (const project of Object.values(state.projects)) {
    if (!project) continue;
    let hit = Array.isArray(project.retiredSessions) && project.retiredSessions.includes(sessionId);
    if (!hit) {
      for (const dept of Object.values(project.departments || {})) {
        if (dept && dept.sessionId === sessionId) { hit = true; break; }
      }
    }
    if (!hit) continue;
    if (!found || num(project.updatedAt) > num(found.updatedAt)) found = project;
  }
  return found;
}

/** 组装注入给模型的参考正文（同步，长度封顶）。 */
function referenceContextText(context) {
  try {
    const agent = context && (context.agent || context.scope);
    const sessionId = agent && agent.session ? agent.session.id : undefined;
    const project = projectOfSession(sessionId);
    if (!project || !Array.isArray(project.references) || project.references.length === 0) return '';

    const lines = [
      `【万象工阁 · 项目参考】项目「${project.name}」的参考材料（用户从会话里挑的，不是本会话的历史）`,
    ];
    let used = 0;
    let truncated = false;
    for (const [index, reference] of project.references.entries()) {
      const label = `—— 参考 ${index + 1}｜来自「${reference.sessionLabel}」${reference.kind === 'session' ? '整段会话' : `${reference.items.length} 条`} ——`;
      if (used + label.length > REFERENCE_CONTEXT_CHARS) {
        truncated = true;
        break;
      }
      lines.push(label);
      used += label.length;
      for (const item of reference.items) {
        const who = item.role === 'assistant' ? 'AI' : '用户';
        const text = item.text.length > 1200 ? `${item.text.slice(0, 1200)}…` : item.text;
        if (used + text.length > REFERENCE_CONTEXT_CHARS) {
          truncated = true;
          break;
        }
        lines.push(`[${who}] ${text}`);
        used += text.length;
      }
      if (truncated) break;
    }
    if (truncated) lines.push('（参考过多已截断；完整内容用 court_get_project view=work 查看）');
    lines.push('用法：这些是背景资料，不要逐条复述；与用户当前指令冲突时，以最新指令为准。');
    return lines.join('\n');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 一键备份：插件源码 + profile 配置 + 万象工阁数据 → 一个 zip
// ---------------------------------------------------------------------------

const BACKUP_DIR = process.env.COURT_BACKUP_DIR || path.join(os.homedir(), '.dsh', 'court-backups');

/**
 * 备份源从「自己现在在哪」推出来，不写死路径。
 * 之前写死的是迁移前的旧软链目标，备份里躺的是过期代码——真出事时恢复出来的是上一版。
 */
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.dirname(PLUGIN_DIR);

const BACKUP_SOURCES = [
  [PLUGIN_DIR, 'plugins/wanxiang-hall'],
  [path.join(PLUGIN_ROOT, 'qa-only'), 'plugins/dsh-qa-only'],
  [path.join(PLUGIN_ROOT, '..', 'projects', 'default-workspace', 'dsh-mobile-pair'), 'plugins/dsh-mobile-pair'],
];

/** 备份时跳过的名字：依赖目录、修复过程留下的两份临时文件、版本库。 */
function skipInBackup(name) {
  return name === 'node_modules' || name === '.git' || name.endsWith('.bak') || name.endsWith('.fixed');
}

async function collectForBackup(root, prefix, out, depth = 0) {
  if (depth > 6) return;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (skipInBackup(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectForBackup(full, `${prefix}/${entry.name}`, out, depth + 1);
    } else if (entry.isFile()) {
      try {
        out.push({ name: `${prefix}/${entry.name}`, data: await fs.readFile(full) });
      } catch {
        /* 读不到就跳过，不让一个文件毁掉整次备份 */
      }
    }
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** DOS 时间戳（zip 用）。 */
function dosStamp(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** 不压缩的 zip（store）：只依赖 node 内置，几 MB 以内够用。 */
function zipStore(entries) {
  const chunks = [];
  const central = [];
  const stamp = dosStamp(new Date());
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014B50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(stamp.time, 12);
    dir.writeUInt16LE(stamp.date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(0, 30);
    dir.writeUInt32LE(0, 34);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, name]));
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}

let backupRunning = null;

/** 备份目录里保留多少个包（备份模式自动清理用）。 */
const BACKUP_KEEP = 10;

/** 内容指纹：文件名 + 内容哈希，内容没变就不重复打新包。 */
function signatureOf(entries) {
  const hash = createHash('sha1');
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    hash.update(entry.name);
    hash.update('\u0000');
    if (entry.name === 'data/court.json') {
      // 这份状态每次备份都会写回 seq / 指纹自身，必须剔掉，否则永远"有变化"。
      let text = entry.data.toString('utf8');
      try {
        const parsed = JSON.parse(text);
        delete parsed.seq;
        if (parsed.settings) delete parsed.settings.lastBackupSignature;
        text = JSON.stringify(parsed);
      } catch {
        /* 解析不了就用原文 */
      }
      hash.update(text);
    } else {
      hash.update(entry.data);
    }
    hash.update('\u0000');
  }
  return hash.digest('hex');
}

/** 只留最近 keep 个备份包（按文件名里的时间戳排序）。 */
async function rotateBackups(keep = BACKUP_KEEP) {
  let names = [];
  try {
    names = await fs.readdir(BACKUP_DIR);
  } catch {
    return [];
  }
  const packs = names
    .filter((name) => /^dsh-backup-\d{8}-\d{6}(-\d{1,3})?\.zip$/.test(name))
    .sort()
    .reverse();
  const removed = [];
  for (const name of packs.slice(keep)) {
    try {
      await fs.unlink(path.join(BACKUP_DIR, name));
      removed.push(name);
    } catch {
      /* 删不掉就留着 */
    }
  }
  return removed;
}

/**
 * 打一个带时间戳的备份包。
 * @param {{force?: boolean}} [options] force 时即使内容和上次一样也新建。
 */
async function runBackup(options = {}) {
  const force = options.force === true;
  if (backupRunning !== null) return backupRunning;
  const job = (async () => {
    const entries = [];
    for (const [root, prefix] of BACKUP_SOURCES) await collectForBackup(root, prefix, entries);

    const profileDir = process.env.DSH_PROFILE_DIR || path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
    for (const name of ['package.json', 'cordis.patch.yml']) {
      try {
        entries.push({ name: `profile/${name}`, data: await fs.readFile(path.join(profileDir, name)) });
      } catch {
        /* 缺了就算了 */
      }
    }
    try {
      entries.push({ name: 'data/court.json', data: await fs.readFile(stateFilePath()) });
    } catch {
      /* 还没有万象工阁数据 */
    }
    if (entries.length === 0) throw new Error('没有可备份的文件');

    const signature = signatureOf(entries);
    const state = await read();
    if (!force && state.settings.lastBackupSignature === signature) {
      return { skipped: true, signature, count: entries.length };
    }

    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      + `-${String(now.getMilliseconds()).padStart(3, '0')}`;
    const file = path.join(BACKUP_DIR, `dsh-backup-${stamp}.zip`);
    const blob = zipStore(entries);
    await fs.writeFile(file, blob);

    await update((current) => {
      current.settings.lastBackupSignature = signature;
    });
    const rotated = await rotateBackups();

    return { file, dir: BACKUP_DIR, bytes: blob.length, count: entries.length, signature, rotated: rotated.length };
  })();
  backupRunning = job.finally(() => {
    backupRunning = null;
  });
  return backupRunning;
}

// ---------------------------------------------------------------------------
// 放权：把万象工阁会话切到「完全权限」
// ---------------------------------------------------------------------------

/** 万象工阁拥有的全部会话 id（接单台 + 各项目岗位 + 历史会话）。 */
function courtSessionIds(state) {
  const ids = new Set();
  if (!state || !state.projects) return [];
  if (state.settings && state.settings.secretarySessionId) ids.add(state.settings.secretarySessionId);
  for (const project of Object.values(state.projects)) {
    for (const dept of Object.values(project.departments || {})) {
      if (dept && dept.sessionId) ids.add(dept.sessionId);
    }
    for (const id of project.retiredSessions || []) ids.add(id);
  }
  return [...ids];
}

/** 把某个活着的会话切到指定权限档；会话不在内存里就返回 false。 */
function setSessionPreset(sessionId, presetName) {
  if (!hostCtx || !sessionId) return false;
  const presets = service(hostCtx, 'permissionPresets');
  const sessions = service(hostCtx, 'sessions');
  if (!presets || typeof presets.set !== 'function') return false;
  if (!sessions || typeof sessions.get !== 'function') return false;
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    presets.set(session, presetName);
    return true;
  } catch (error) {
    console.warn('[court] 切换权限失败：', error?.message ?? error);
    return false;
  }
}

/**
 * 开关「放权」：记住开关状态，并把当前所有万象工阁会话切到目标档。
 * 之后新建的会话由 agent/created 监听补上。
 */
async function setGrant(body) {
  const on = body.on !== false;
  const preset = on ? 'danger-full-access' : 'workspace-write';
  await update((state) => {
    state.settings.grantFullAccess = on;
  });
  const state = await read();
  const ids = courtSessionIds(state);
  let applied = 0;
  for (const id of ids) if (setSessionPreset(id, preset)) applied += 1;
  return { on, preset, applied, candidates: ids.length };
}

// ---------------------------------------------------------------------------
// 备份模式：定时自动打包
// ---------------------------------------------------------------------------

const BACKUP_INTERVAL_MS = 15 * 60 * 1000;
let backupTimer = null;

function stopBackupTimer() {
  if (backupTimer !== null) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

function startBackupTimer() {
  stopBackupTimer();
  backupTimer = setInterval(() => {
    void runBackup().catch((error) => console.warn('[court] 自动备份失败：', error?.message ?? error));
  }, BACKUP_INTERVAL_MS);
  if (typeof backupTimer.unref === 'function') backupTimer.unref();
}

/** 开关备份模式。 */
async function setBackupMode(body) {
  const on = body.on === true;
  await update((state) => {
    state.settings.backupMode = on;
  });
  if (on) startBackupTimer();
  else stopBackupTimer();
  return { on, intervalMinutes: BACKUP_INTERVAL_MS / 60000 };
}

/**
 * 从会话摘要里尽力取标题：session-title 包可能把标题放在投影值里，
 * 取不到就用工作目录名兜底（客户端选完会话后会再用首条消息补）。
 */
function titleOfSummary(summary) {
  const values = summary && summary.projections ? summary.projections.values : undefined;
  if (!values || typeof values !== 'object') return '';
  for (const key of ['title', 'sessionTitle']) {
    const value = values[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && typeof value.title === 'string' && value.title.trim()) {
      return value.title.trim();
    }
  }
  return '';
}

/** 非万象工阁的 DSH 会话（用户自己的普通对话），用于「项目参考」选材。 */
async function dshSessionRows() {
  const controller = hostCtx ? service(hostCtx, 'sessionController') : null;
  if (!controller || typeof controller.list !== 'function') return [];
  let items = [];
  try {
    const result = await controller.list({}, new AbortController().signal);
    items = Array.isArray(result && result.items) ? result.items : [];
  } catch (error) {
    console.warn('[court] 读取会话列表失败：', error?.message ?? error);
    return [];
  }
  return items
    .filter((item) => item && item.sessionId && item.origin !== 'subagent' && item.blank !== true)
    .sort((a, b) => num(b.updatedAt) - num(a.updatedAt))
    .map((item) => ({
      sessionId: item.sessionId,
      title: titleOfSummary(item) || path.basename(String(item.cwd || '')) || String(item.sessionId).slice(0, 12),
      role: 'dsh',
      group: 'dsh',
      projectId: null,
      projectName: path.basename(String(item.cwd || '')),
      updatedAt: num(item.updatedAt),
    }));
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

async function handler(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const suffix = url.pathname.slice(API_PREFIX.length) || '/';

  try {
    assertSameOrigin(req, { allowBinary: suffix === '/attachments' });
    await read();

    if (req.method === 'GET' && (suffix === '/state' || suffix === '/')) {
      const snap = await snapshot();
      // 旧 store 模块实例可能还没有「暂停」统计，这里补一份（重启后由 store 自己算）。
      if (snap && snap.counts && Array.isArray(snap.projects)) {
        const projects = snap.projects;
        if (snap.counts.paused === undefined) {
          snap.counts.paused = projects.filter((project) => project.status === 'paused').length;
        }
        snap.counts.active = projects.filter((project) => !['done', 'archived', 'paused'].includes(project.status)).length;
        // 心跳只在这一层派生：面板看到的是事实，不是谁的自报。
        const now = Date.now();
        for (const project of projects) {
          const health = healthOf(project, { now });
          project.health = health;
          project.healthText = describeHealth(health, project);
          // 时间盒与「卡在客户那儿的事」也在这一层派生，前台不用各自算。
          project.appetiteView = appetiteOf(project, now);
          project.appetiteText = appetiteText(project, now);
          project.manualPending = (project.manual ?? []).filter((item) => item.status !== 'done').length;
          project.manualBlocking = (project.manual ?? []).filter((item) => item.status !== 'done' && item.blocking).length;
          project.questionsOpen = (project.questions ?? []).filter((item) => !item.answer).length;
          project.briefCount = (project.briefs ?? []).length;
          project.quadrant = quadrantOf(project);
        }
        snap.portfolio = projects.map((project) => ({
          id: project.id,
          name: project.name,
          shape: project.shape,
          status: project.status,
          progress: project.progress,
          priority: project.priority,
          quadrant: project.quadrant,
          health: { state: project.health.state, level: project.health.level, label: project.health.label },
          appetite: project.appetiteView,
          packages: (project.packages ?? []).length,
          packagesDoing: (project.packages ?? []).filter((item) => item.state === 'doing' || item.state === 'ready').length,
          manualPending: project.manualPending,
          manualBlocking: project.manualBlocking,
          questionsOpen: project.questionsOpen,
          rounds: project.rounds,
          updatedAt: project.updatedAt,
        }));
      }
      const kbEntries = (await read()).kb?.entries || [];
      snap.kb = { stats: kbStats(kbEntries), pinned: kbEntries.filter((entry) => entry.pinned).length };
      return sendJson(res, 200, { apiVersion: API_VERSION, ...snap });
    }
    if (req.method === 'GET' && suffix === '/kb') {
      const state = await read();
      const entries = state.kb?.entries || [];
      const q = str(url.searchParams.get('q'));
      const kind = str(url.searchParams.get('kind')) || null;
      const tag = str(url.searchParams.get('tag')) || null;
      const limit = Math.min(200, Math.max(1, num(url.searchParams.get('limit'), 40)));
      const hits = searchEntries(entries, q, { kind, tag, limit });
      const tags = new Map();
      for (const entry of entries) {
        for (const one of entry.tags) tags.set(one, (tags.get(one) || 0) + 1);
      }
      return sendJson(res, 200, {
        apiVersion: API_VERSION,
        stats: kbStats(entries),
        kinds: KB_KINDS.map((key) => ({ key, label: KB_KIND_LABEL[key] })),
        tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([name, count]) => ({ name, count })),
        hits: hits.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          title: entry.title,
          body: entry.body,
          tags: entry.tags,
          pinned: entry.pinned,
          confidence: entry.confidence,
          projectId: entry.projectId,
          from: entry.projectName || entry.projectId || '',
          briefId: entry.briefId,
          updatedAt: entry.updatedAt,
          score: entry.score,
        })),
      });
    }
    if (req.method === 'POST' && suffix === '/kb/save') {
      const body = await readJson(req);
      const state = await read();
      const projectId = str(body.projectId) || null;
      const project = projectId ? state.projects[projectId] : null;
      const now = Date.now();
      const entry = normalizeEntry(
        {
          id: makeId('kb'),
          kind: body.kind,
          title: body.title,
          body: body.body,
          tags: body.tags,
          projectId,
          projectName: project?.name || '',
          briefId: str(body.briefId) || null,
          source: 'panel',
          pinned: body.pinned === true,
          confidence: body.confidence,
          createdAt: now,
          updatedAt: now,
          by: 'user',
        },
        now,
      );
      if (!entry.title || entry.title === '（无标题）') throw new Error('标题不能为空');
      let total = 0;
      await update((current) => {
        if (!current.kb) current.kb = { entries: [] };
        current.kb.entries.unshift(entry);
        if (current.kb.entries.length > KB_MAX_ENTRIES) current.kb.entries.length = KB_MAX_ENTRIES;
        total = current.kb.entries.length;
      });
      return sendJson(res, 200, { entry: { id: entry.id, title: entry.title }, total });
    }
    if (req.method === 'POST' && suffix === '/kb/update') {
      const body = await readJson(req);
      const id = str(body.id);
      let view = null;
      let removed = false;
      await update((current) => {
        const entries = current.kb?.entries || [];
        const index = entries.findIndex((entry) => entry.id === id);
        if (index < 0) throw new Error(`知识条目不存在：${id}`);
        if (body.remove === true) {
          entries.splice(index, 1);
          removed = true;
          return;
        }
        const target = entries[index];
        if (typeof body.pinned === 'boolean') target.pinned = body.pinned;
        if (body.confidence !== undefined) target.confidence = Math.max(0, Math.min(3, num(body.confidence, target.confidence)));
        if (str(body.title)) target.title = str(body.title).slice(0, 120);
        if (str(body.body)) target.body = str(body.body).slice(0, KB_MAX_BODY);
        if (Array.isArray(body.tags)) target.tags = normalizeEntry({ ...target, tags: body.tags }).tags;
        target.updatedAt = Date.now();
        view = target;
      });
      return sendJson(res, 200, { removed, entry: view });
    }
    if (req.method === 'POST' && suffix === '/kb/digest') {
      const body = await readJson(req);
      const state = await read();
      const project = state.projects[str(body.projectId)];
      if (!project) throw new Error(`项目不存在：${str(body.projectId)}`);
      const candidates = digestCandidates(project, state.kb?.entries || []);
      return sendJson(res, 200, {
        candidates: candidates.map((entry) => ({
          kind: entry.kind,
          title: entry.title,
          body: entry.body,
          tags: entry.tags,
          projectId: project.id,
          projectName: project.name,
        })),
      });
    }
    if (req.method === 'POST' && suffix === '/attachments') {
      return sendJson(res, 200, await saveAttachment(req, url));
    }
    if (req.method === 'POST' && suffix === '/attachments/delete') {
      return sendJson(res, 200, await deleteAttachment(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/projects/references') {
      return sendJson(res, 200, await addReference(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/projects/references/remove') {
      return sendJson(res, 200, await removeReference(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/session-messages') {
      const body = await readJson(req);
      const sessionId = str(body.sessionId);
      const result = await readSessionMessages(sessionId);
      return sendJson(res, 200, { sessionId, messages: result.messages, types: result.types, sample: result.sample });
    }
    if (req.method === 'POST' && suffix === '/projects') {
      return sendJson(res, 200, { project: await createProject(await readJson(req)) });
    }
    if (req.method === 'PATCH' && suffix === '/projects') {
      return sendJson(res, 200, { project: await patchProject(await readJson(req)) });
    }
    if (req.method === 'POST' && suffix === '/projects/delete') {
      return sendJson(res, 200, await deleteProject(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/milestones') {
      return sendJson(res, 200, { project: await toggleMilestone(await readJson(req)) });
    }
    if (req.method === 'POST' && suffix === '/jump') {
      return sendJson(res, 200, await clearJump());
    }
    if (req.method === 'GET' && suffix === '/sessions') {
      const state = await read();
      const court = sessionRows(state).map((row) => ({ ...row, group: 'court' }));
      const known = new Set(court.map((row) => row.sessionId));
      const others = (await dshSessionRows()).filter((row) => !known.has(row.sessionId));
      return sendJson(res, 200, { sessions: [...court, ...others] });
    }
    if (req.method === 'POST' && suffix === '/sessions/archive') {
      return sendJson(res, 200, await archiveSessions(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/sessions/unarchive') {
      const body = await readJson(req);
      const sessionId = str(body.sessionId);
      if (!sessionId) throw Object.assign(new Error('sessionId 不能为空'), { status: 400 });
      const registry = hostCtx ? service(hostCtx, 'workspaceRegistry') : null;
      if (!registry || typeof registry.unarchiveSession !== 'function') {
        throw Object.assign(new Error('workspaceRegistry 未就绪'), { status: 503 });
      }
      await registry.unarchiveSession(sessionId);
      return sendJson(res, 200, { ok: true, sessionId });
    }
    if (req.method === 'POST' && suffix === '/vault/intake') {
      return sendJson(res, 200, await intakeVault(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/vault/status') {
      return sendJson(res, 200, { status: await vaultStatus(await readJson(req)) });
    }
    if (req.method === 'POST' && suffix === '/questions/answer') {
      return sendJson(res, 200, await answerQuestion(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/settings') {
      const body = await readJson(req);
      const input = str(body.vaultPath).trim();
      if (!input) throw Object.assign(new Error('vaultPath 不能为空'), { status: 400 });
      let resolved;
      try {
        resolved = await validateVaultRoot(input);
      } catch (error) {
        throw Object.assign(error, { status: 400 });
      }
      let result = null;
      await update((state) => {
        state.settings.vaultPath = resolved.root;
        result = state.settings;
      });
      return sendJson(res, 200, { settings: result, resolved });
    }
    if (req.method === 'POST' && suffix === '/checks') {
      const body = await readJson(req);
      const projectId = str(body.projectId);
      let checks;
      try {
        checks = normalizeChecks(body.checks, { strict: true });
      } catch (error) {
        throw Object.assign(error, { status: 400 });
      }
      for (const shell of new Set(checks.map((check) => check.shell))) {
        try {
          await probeShell(shell);
        } catch (error) {
          throw Object.assign(error, { status: 400 });
        }
      }
      let result = null;
      await update((state) => {
        const project = state.projects[projectId];
        if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
        if (!['draft', 'zhongshu', 'menxia', 'shangshu', 'blocked'].includes(project.status)) {
          throw Object.assign(new Error(`项目已进入 ${project.status}，验收命令已锁定`), { status: 400 });
        }
        project.checks = checks;
        project.updatedAt = Date.now();
        result = decorate(project);
      });
      return sendJson(res, 200, { project: result });
    }
    if (req.method === 'POST' && suffix === '/scope/confirm') {
      const body = await readJson(req);
      const projectId = str(body.projectId);
      let result = null;
      await update((state) => {
        const project = state.projects[projectId];
        if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
        const plan = [...project.briefs].reverse().find((brief) => brief.kind === 'plan');
        project.scope.confirmedAt = Date.now();
        project.scope.confirmedBy = 'user';
        if (plan) {
          project.scope.approvedPlanId = plan.id;
          project.scope.approvedAt = Date.now();
        }
        project.history.push({
          at: Date.now(),
          from: project.status,
          to: project.status,
          by: 'user',
          note: `需求基线确认：${str(body.note) || '无备注'}`,
          reportId: null,
        });
        project.updatedAt = Date.now();
        result = decorate(project);
      });
      return sendJson(res, 200, { project: result });
    }
    if (req.method === 'POST' && suffix === '/secretary') {
      const body = await readJson(req);
      if (!hostCtx) throw new Error('宿主上下文尚未就绪');
      return sendJson(res, 200, await talkToSecretary(hostCtx, body.text));
    }
    if (req.method === 'POST' && suffix === '/secretary/ensure') {
      if (!hostCtx) throw new Error('宿主上下文尚未就绪');
      return sendJson(res, 200, await ensureSecretarySession(hostCtx));
    }
    if (req.method === 'POST' && suffix === '/secretary/reset') {
      if (!hostCtx) throw new Error('宿主上下文尚未就绪');
      return sendJson(res, 200, await resetSecretarySession(hostCtx));
    }
    if (req.method === 'POST' && suffix === '/backup') {
      return sendJson(res, 200, await runBackup(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/backup/mode') {
      return sendJson(res, 200, await setBackupMode(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/grant') {
      return sendJson(res, 200, await setGrant(await readJson(req)));
    }
    if (req.method === 'POST' && suffix === '/handoff') {
      const body = await readJson(req);
      if (!hostCtx) throw new Error('宿主上下文尚未就绪');
      return sendJson(res, 200, await performHandoff(hostCtx, {
        projectId: str(body.projectId),
        to: str(body.to || 'zhongshu'),
        from: 'user',
        note: str(body.note),
        briefTitle: str(body.briefTitle),
        briefContent: str(body.briefContent),
      }));
    }
    if (req.method === 'GET' && suffix === '/health') {
      return sendJson(res, 200, {
        ok: true,
        apiVersion: API_VERSION,
        file: stateFilePath(),
        stateProblem: readProblem(),
      });
    }
    return sendError(res, 404, 'not-found', `未知接口 ${req.method} ${suffix}`);
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    return sendError(res, status, 'court-error', error?.message ?? String(error));
  }
}

// ---------------------------------------------------------------------------
// 巡夜：没人按铃的时候，替你看一眼
// ---------------------------------------------------------------------------

function nudgeText(project, health) {
  const toolMinutes = project.updatedAt ? Math.round((Date.now() - project.updatedAt) / 60000) : null;
  return [
    '【万象工阁 · 巡夜】',
    `项目「${project.name}」现在停在「${project.status}」，${health.label}。`,
    toolMinutes === null ? '' : `最后一次写文书是 ${toolMinutes} 分钟前。`,
    '',
    '先用一条消息回答三件事：卡在哪、下一步做什么、还要几个动作。然后按情况处理：',
    '· 还在做 → 继续做，并把这一阶段的结论写成文书（court_save_brief）。只干活不落文书，面板上等于没动。',
    '· 已经做完 → 有登记 checks 就先 court_verify，再用 court_handoff 交出去。',
    '· 做不下去 → court_update_project 置 blocked，写明卡点。',
  ].filter((line) => line !== '').join('\n');
}

async function watchOnce(ctx) {
  const state = await read();
  const now = Date.now();
  for (const project of Object.values(state.projects)) {
    const role = STAGE_ROLE[project.status];
    if (!role) continue;
    const sessionId = (project.departments && project.departments[role] && project.departments[role].sessionId) || null;

    // 「进程在跑」不等于「在产出」：running 只用来区分「卡住」和「空转」。
    // v1.7 在这里直接 continue，于是卡在 running 的会话永远不会被发现。
    let running = false;
    if (sessionId) {
      try {
        const agent = service(ctx, 'agents')?.get?.(sessionId);
        running = Boolean(agent && agent.status && agent.status !== 'idle');
      } catch {
        running = false;
      }
    }

    const stamp = sessionId ? stampOf(sessionId, now) : null;
    const health = healthOf(project, { now, stamp, running });
    const patch = heartbeatPatch(project, stamp, now);

    // 心跳记账：证明它「确实在动但没交东西」，这是 v1.7 看不见的那一半事实。
    if (patch || health.state === 'working') {
      await update((current) => {
        const target = current.projects[project.id];
        if (!target || !target.activity) return;
        if (patch) {
          target.activity.lastAt = patch.lastAt;
          target.activity.lastSize = patch.lastSize;
        }
        if (health.state === 'working') {
          target.activity.nudges = 0;
          target.activity.escalatedAt = null;
        }
      });
    }

    // 时间盒到点：只报一次，把「砍范围 / 延期 / 结项」交给客户，不自己续期。
    if (!['done', 'archived'].includes(project.status)) {
      const breach = appetiteBreach(project, now);
      if (breach) {
        await update((current) => {
          const target = current.projects[project.id];
          if (target && target.appetite) target.appetite.breachedAt = breach.at;
        });
        try {
          await talkToSecretary(
            ctx,
            [
              `【时间盒】项目「${project.name}」的时间盒到了：${breach.text}。`,
              '按当初的约定，现在只有三种处理：',
              '① 砍范围：把已经能用的部分先交付，剩下的另立项目；',
              '② 延期：客户给一个明确的新期限（court_set_appetite 传 extendHours，记谁批的）；',
              '③ 结项/中止：写清停在哪儿。',
              '客户回话前不自动续期，也不再自动催办这个项目。',
            ].join('\n'),
          );
        } catch (error) {
          console.warn('[court] 时间盒上报失败：', error?.message ?? error);
        }
      }
    }

    // 「催不催、要不要报人」只由 nextAction 决定（纯函数，有测试兜着）。
    const decision = nextAction(project, health, now);
    if (decision.action === 'none') continue;

    if (decision.action === 'report') {
      await update((current) => {
        const target = current.projects[project.id];
        if (target && target.activity) target.activity.escalatedAt = now;
      });
      try {
        await talkToSecretary(
          ctx,
          `【巡夜】项目「${project.name}」当前在「${project.status}」，${health.label}。请换一个会话接手，或让客户决定怎么处理。`,
        );
      } catch (error) {
        console.warn('[court] 巡夜上报失败：', error?.message ?? error);
      }
      continue;
    }

    if (decision.action === 'escalate') {
      await update((current) => {
        const target = current.projects[project.id];
        if (!target) return;
        target.lastNudgeAt = now;
        if (target.activity) target.activity.escalatedAt = now;
      });
      try {
        await talkToSecretary(
          ctx,
          [
            `【需要决策】项目「${project.name}」在「${project.status}」已经 ${health.label}，催办 ${MAX_NUDGES} 次没有产出。`,
            '三选一：继续等它 / 换一个会话接手 / 砍掉范围先交付。',
            '客户确认前我不会再自动催办。',
          ].join('\n'),
        );
      } catch (error) {
        console.warn('[court] 巡夜上报失败：', error?.message ?? error);
      }
      continue;
    }

    // nudge：记一次催办，然后把话投进去。
    await update((current) => {
      const target = current.projects[project.id];
      if (!target) return;
      target.lastNudgeAt = now;
      if (target.activity) target.activity.nudges = ((target.activity.nudges || 0) + 1);
    });

    // 走到这里只可能是 stale / stuck：会话确实 90 分钟以上没有新帧。
    try {
      await promptSession(ctx, sessionId, nudgeText(project, health));
    } catch (error) {
      console.warn('[court] 巡夜投递失败：', error?.message ?? error);
    }
  }
}

function startWatchdog(ctx) {
  const timer = setInterval(() => {
    void watchOnce(ctx).catch((error) => console.warn('[court] 巡夜异常：', error?.message ?? error));
  }, WATCH_INTERVAL_MS);
  // 不让巡夜定时器把进程吊住（宿主退出时该退就退）
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

export const inject = ['webServer'];

export function apply(ctx) {
  hostCtx = ctx;
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
    'court: /court http api',
  );
  ctx.effect(() => startWatchdog(ctx), 'court: 巡夜');

  // 备份模式：按已保存的开关恢复定时器。
  void read()
    .then((state) => {
      if (state && state.settings && state.settings.backupMode === true) startBackupTimer();
    })
    .catch(() => {});

  // 放权开着时，新建的万象工阁会话自动落到「完全权限」。
  // 判据用会话头里的 agentPreset（court-*），因为新会话在 agent/created 时
  // 还没被写进项目的 departments。
  ctx.on('agent/created', ({ agent }) => {
    try {
      const id = agent && agent.id;
      if (!id) return;
      const state = stateSync();
      if (!state || state.settings.grantFullAccess !== true) return;
      const agentPreset = agent && agent.session && agent.session.header
        ? String(agent.session.header.agentPreset || '')
        : '';
      if (!agentPreset.startsWith('court-') && !courtSessionIds(state).includes(id)) return;
      setSessionPreset(id, 'danger-full-access');
    } catch (error) {
      console.warn('[court] 放权自动应用失败：', error?.message ?? error);
    }
  });

  ctx.effect(function* () {
    yield () => stopBackupTimer();
  }, 'court: 备份模式定时器');

  // 「项目参考」：只注入到属于该项目的会话（岗位/工程师），
  // 接单台是跨项目的，按需用 court_get_project view=work 读。
  ctx.inject(['systemPrompt'], (child) => {
    child.effect(function* () {
      yield child.systemPrompt.context({
        name: 'court:project-reference',
        order: 130,
        interpolate: false,
        text: (context) => referenceContextText(context),
      });
    }, 'court: 项目参考注入');
  });

  void read();
}
