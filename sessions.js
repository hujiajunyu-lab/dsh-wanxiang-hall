/**
 * 会话编排：在万象工阁语境下开/复用会话并投递消息。
 * tools.js 与 index.js（HTTP 路由）共用，避免两套实现漂移。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function service(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

export function samePath(a, b) {
  const norm = (value) => String(value ?? '').replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureWorkspace(ctx, dirPath, title) {
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

export async function openCourtSession(ctx, { preset, dirPath, title, sessionTitle }) {
  const controller = service(ctx, 'sessionController');
  if (!controller) throw new Error('sessionController 未挂载，无法开新会话');

  await ensureDir(dirPath);
  const workspace = await ensureWorkspace(ctx, dirPath, title);

  const request = workspace
    ? { workspaceId: workspace.id, agentPreset: preset }
    : { cwd: dirPath, agentPreset: preset };

  const created = await controller.create(request);
  if (sessionTitle) await renameSession(ctx, created.sessionId, sessionTitle);
  return created.sessionId;
}

export async function renameSession(ctx, sessionId, title) {
  const controller = service(ctx, 'sessionController');
  if (!controller || typeof controller.rename !== 'function') return false;
  try {
    await controller.rename({ sessionId, title });
    return true;
  } catch (error) {
    console.warn('[court] 会话重命名失败：', error?.message ?? error);
    return false;
  }
}

export async function promptSession(ctx, sessionId, text) {
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
    throw new Error('找不到可用的会话通道，无法投递消息');
  }
  // sessionController.prompt 的第二个参数是必需的 AbortSignal；不传会让核心
  // 在 signal.throwIfAborted() 上读到 undefined。这里给一个不取消的信号。
  const abort = new AbortController();
  await controller.prompt({
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
    requestId: `court-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  }, abort.signal);
}

/** 找一个可直接打开的会话 id 是否还在（用于复用前的基本校验）。 */
export function isLive(ctx, sessionId) {
  if (!sessionId) return false;
  const agents = service(ctx, 'agents');
  if (!agents || typeof agents.get !== 'function') return false;
  try {
    return Boolean(agents.get(sessionId));
  } catch {
    return false;
  }
}

export function baseName(dirPath) {
  const name = path.basename(dirPath);
  return name || '万象工阁';
}
