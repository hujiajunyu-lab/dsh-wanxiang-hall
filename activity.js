/**
 * activity.js —— 心跳：这个项目到底有没有在动
 *
 * 为什么不信角色自报：v1.7 的回合/文书全靠 agent 主动调工具才动，
 * 于是「会话里做了 72 件事、面板上 0 回合 0 文书」成立了两天。
 *
 * 这里换成一个骗不了人的事实源：会话日志文件的写入时间。
 *   ~/.dsh/sessions/<项目目录>/session-<uuid>/session.v4.jsonl.zstd
 * 每追加一帧，mtime 就前进（已实测：正在干活的会话 mtime 与当前时间同秒）。
 *
 * 约束：
 *  - 只读，不写 court.json，不改状态机；
 *  - stale / stuck / dead 全部是派生值，面板怎么显示都不影响项目状态；
 *  - 零依赖，可被 node --test 直接加载。
 */

import path from 'node:path';
import os from 'node:os';
import { readdirSync, statSync } from 'node:fs';

/** 会话日志文件名（DSH 当前版本）。 */
const SESSION_FILE = 'session.v4.jsonl.zstd';

/** 会话根目录：允许用环境变量覆盖，测试时指向临时目录。 */
export function sessionsRoot() {
  return process.env.COURT_SESSIONS_ROOT || path.join(os.homedir(), '.dsh', 'sessions');
}

/** 有活动 = 15 分钟内有写入。 */
export const WORKING_MS = 15 * 60 * 1000;
/** 95 分钟没有写入 = 空转。 */
export const IDLE_MS = 90 * 60 * 1000;
/** 进程在跑、但会话 30 分钟没有新帧 = 卡住（比空转更可疑）。 */
export const STUCK_MS = 30 * 60 * 1000;

/** 状态 → 该谁负责（与 index.js 的 STAGE_ROLE 同源，这里作唯一出处）。 */
export const STAGE_ROLE = {
  zhongshu: 'zhongshu',
  menxia: 'menxia',
  shangshu: 'shangshu',
  executing: 'executor',
  review: 'menxia',
};

/** 这些状态下不该有心跳，也不该被催办。 */
const SETTLED = new Set(['draft', 'done', 'archived', 'paused', 'blocked']);

// ---------------------------------------------------------------------------
// 会话文件索引：sessionId → 文件路径（一次扫描，5 分钟内复用）
// ---------------------------------------------------------------------------

let index = new Map();
let indexAt = 0;
const INDEX_TTL_MS = 5 * 60 * 1000;

function looksLikeSessionId(name) {
  const id = name.startsWith('session-') ? name.slice('session-'.length) : name;
  return /^[0-9a-f][0-9a-f-]{15,}$/i.test(id);
}

function idOf(dirName) {
  return dirName.startsWith('session-') ? dirName.slice('session-'.length) : dirName;
}

/** 重建索引。目录不存在就当空索引（不抛）。 */
export function rebuildIndex(root = sessionsRoot()) {
  const next = new Map();
  let projects = [];
  try {
    projects = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    projects = [];
  }
  for (const projectDir of projects) {
    const base = path.join(root, projectDir.name);
    let entries = [];
    try {
      entries = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!looksLikeSessionId(entry.name)) continue;
      const file = path.join(base, entry.name, SESSION_FILE);
      try {
        if (!statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      next.set(idOf(entry.name), file);
    }
  }
  index = next;
  indexAt = Date.now();
  return index;
}

/** sessionId → 会话日志绝对路径，找不到返回 null。 */
export function sessionFile(sessionId) {
  // court.json 里存的是完整 id（session-xxxx），索引里存裸 uuid，两种都认。
  const id = String(sessionId || '').trim().replace(/^session-/, '');
  if (!id) return null;
  if (index.has(id)) return index.get(id);
  if (Date.now() - indexAt > INDEX_TTL_MS) rebuildIndex();
  if (index.has(id)) return index.get(id);
  // 还没到重建时间但可能真是新会话：再扫一次，代价可接受（每项目两次 stat）。
  rebuildIndex();
  return index.get(id) || null;
}

/**
 * 读取会话日志的最后写入时间。
 * @returns {{at:number, bytes:number, file:string}|null}
 */
export function stampOf(sessionId, now = Date.now()) {
  const file = sessionFile(sessionId);
  if (!file) return null;
  try {
    const stat = statSync(file);
    return { at: stat.mtimeMs, bytes: stat.size, file };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 派生健康度
// ---------------------------------------------------------------------------

function minutesOf(ms) {
  return Math.max(0, Math.round(ms / 60000));
}

/**
 * 项目健康度。纯函数：不读盘，不写状态。
 *
 * @param {object} project  court.json 里的项目对象
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @param {{at:number,bytes:number}|null} [opts.stamp] 会话文件写入时间（调用方已取）
 * @param {boolean} [opts.running] 该环节的 agent 是否正在跑
 */
export function healthOf(project, opts = {}) {
  const now = opts.now ?? Date.now();
  const status = String(project?.status || '');
  const role = STAGE_ROLE[status] || null;
  const dept = role ? project?.departments?.[role] : null;
  const sessionId = dept?.sessionId || null;

  if (SETTLED.has(status)) {
    return {
      state: 'settled', level: 'ok', minutes: null, sessionId: null,
      label: status === 'blocked' ? '已卡住' : '已停', role,
    };
  }
  if (!role) {
    return { state: 'idle', level: 'ok', minutes: null, sessionId: null, label: '不在流水线上', role: null };
  }
  if (!sessionId) {
    return {
      state: 'unassigned', level: 'bad', minutes: null, sessionId: null,
      label: '该环节还没有会话', role,
    };
  }

  const stamp = opts.stamp === undefined ? stampOf(sessionId, now) : opts.stamp;
  if (!stamp) {
    return {
      state: 'dead', level: 'bad', minutes: null, sessionId,
      label: '会话文件不可用（可能已损坏）', role,
    };
  }

  const idleMs = Math.max(0, now - stamp.at);
  const minutes = minutesOf(idleMs);
  const running = opts.running === true;

  if (running && idleMs > STUCK_MS) {
    return {
      state: 'stuck', level: 'bad', minutes, sessionId,
      label: `在跑，但 ${minutes} 分钟没有产出`, role, bytes: stamp.bytes,
    };
  }
  if (idleMs <= WORKING_MS) {
    return {
      state: 'working', level: 'ok', minutes, sessionId,
      label: minutes <= 0 ? '刚刚有动作' : `${minutes} 分钟前有动作`, role, bytes: stamp.bytes,
    };
  }
  if (idleMs <= IDLE_MS) {
    return {
      state: 'quiet', level: 'warn', minutes, sessionId,
      label: `${minutes} 分钟没有动作`, role, bytes: stamp.bytes,
    };
  }
  return {
    state: 'stale', level: 'bad', minutes, sessionId,
    label: `疑似空转 ${minutes} 分钟`, role, bytes: stamp.bytes,
  };
}

/** 催办冷却：同一条流水线 30 分钟内只催一次。 */
export const NUDGE_COOLDOWN_MS = 30 * 60 * 1000;

/** 催到第几次就不再自己循环、改问人。 */
export const MAX_NUDGES = 2;

/**
 * 该拿这个项目怎么办。纯函数，把「要不要催/要不要报人」从 IO 里拆出来，
 * 这样 node --test 能直接验证，不用起宿主。
 *
 * @returns {{action:'none'|'nudge'|'report'|'escalate', reason?:string}}
 */
export function nextAction(project, health, now = Date.now()) {
  if (!health || health.level !== 'bad') return { action: 'none', reason: 'healthy' };

  const activity = project?.activity || {};
  const nudges = activity.nudges || 0;

  // 没有会话 / 会话坏了：催它也没用，直接上报换人。
  if (health.state === 'dead' || health.state === 'unassigned') {
    if (activity.escalatedAt) return { action: 'none', reason: 'already-reported' };
    return { action: 'report', reason: health.state };
  }

  // 催过两次还是没产出：不自作主张循环，把三选一推给人。
  if (nudges >= MAX_NUDGES) {
    if (activity.escalatedAt) return { action: 'none', reason: 'already-escalated' };
    return { action: 'escalate', reason: 'no-response' };
  }

  if (now - (project?.lastNudgeAt || 0) < NUDGE_COOLDOWN_MS) {
    return { action: 'none', reason: 'cooldown' };
  }
  return { action: 'nudge' };
}

/**
 * 需要写回 court.json 的心跳补丁（没变化就返回 null，避免无意义的写盘）。
 * 只记事实，不做判断。
 */
export function heartbeatPatch(project, stamp, now = Date.now()) {
  if (!stamp) return null;
  const last = project?.activity || {};
  if (last.lastAt === stamp.at && last.lastSize === stamp.bytes) return null;
  return { lastAt: stamp.at, lastSize: stamp.bytes, at: now };
}

/** 面板/工具用的一行摘要。 */
export function describeHealth(health, project) {
  if (!health) return '';
  const toolMinutes = project?.updatedAt ? minutesOf(Date.now() - project.updatedAt) : null;
  const parts = [health.label];
  if (toolMinutes !== null && health.minutes !== null && toolMinutes > health.minutes + 30) {
    parts.push(`但已经 ${toolMinutes} 分钟没写任何文书`);
  }
  return parts.join('，');
}

// ---------------------------------------------------------------------------
// 时间盒（appetite）
// ---------------------------------------------------------------------------

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * 时间盒从立项那一刻起算。Shape Up 的说法：先定「愿意花多久」，再设计到装得进去；
 * 到点默认不续期——续期要有人签字，写进 extensions。
 */
export function appetiteOf(project, now = Date.now()) {
  const box = project && project.appetite;
  if (!box || !(Number(box.maxMs) > 0)) return null;
  const start = Number(box.startedAt) || Number(project.createdAt) || now;
  const usedMs = Math.max(0, now - start);
  const remainingMs = Number(box.maxMs) - usedMs;
  return {
    maxMs: Number(box.maxMs),
    usedMs,
    remainingMs,
    over: remainingMs <= 0,
    hours: round1(Number(box.maxMs) / 3600000),
    usedHours: round1(usedMs / 3600000),
    leftHours: round1(remainingMs / 3600000),
    breachedAt: Number(box.breachedAt) || null,
    extensions: Array.isArray(box.extensions) ? box.extensions : [],
  };
}

export function appetiteText(project, now = Date.now()) {
  const box = appetiteOf(project, now);
  if (!box) return '';
  if (box.over) {
    return `时间盒 ${box.hours}h 已用完（实际 ${box.usedHours}h）：砍范围、延期（要签字）或结项`;
  }
  return `时间盒 ${box.hours}h，已用 ${box.usedHours}h，还剩 ${box.leftHours}h`;
}

/** 到点且还没上报过 → 返回一次性的上报体；已经报过返回 null。 */
export function appetiteBreach(project, now = Date.now()) {
  const box = appetiteOf(project, now);
  if (!box || !box.over || box.breachedAt) return null;
  return { at: now, text: appetiteText(project, now) };
}
