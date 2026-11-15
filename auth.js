/**
 * 万象工阁授权矩阵：谁能把项目从哪个状态推到哪个状态、谁能写哪类文书。
 *
 * 纯函数，不依赖宿主；tools.js / handoff.js 只负责拿 caller 角色并调用这里。
 * `user` 是人工旁路：UI 按钮/HTTP 人工操作允许覆盖状态，但必须在 history 里留痕。
 */

/**
 * 编制（shape）：这家「外包公司」开几个省。一张纯数据表定死，不再到处写 if。
 *
 * - squad 轻量岗位：架构（架构师）出契约 → 交付（项目经理）审完自己动手 → 秘书抽验结项。
 *   没有评审，也没有工程师席位：项目经理既是 PM 也是工程师，省两个会话、两轮往返。
 * - crew  完整岗位：架构 → 评审 → PM → 工程师。多人、多模块、需要第三方把关时用。
 * - line  批量工单：架构 + 交付 + N 个工程师。一次派多条同构工单（爬取、批量改文件）。
 */
export const SHAPES = ['squad', 'crew', 'line'];

export const SHAPE_META = {
  squad: { label: '轻量组', short: '轻量', roles: ['zhongshu', 'shangshu'], rejectCap: 1 },
  crew: { label: '项目组', short: '项目', roles: ['zhongshu', 'menxia', 'shangshu', 'executor'], rejectCap: 2 },
  line: { label: '流水线', short: '批量', roles: ['zhongshu', 'shangshu', 'executor'], rejectCap: 1 },
};

/** 结果类阶段三种编制共用：谁都能报阻塞，秘书能归档。 */
const RESULT_STAGES = {
  blocked: { secretary: ['zhongshu', 'menxia', 'shangshu', 'executing', 'review', 'done'] },
  done: { secretary: ['archived'] },
  archived: {},
};

const SQUAD_STAGES = {
  draft: { secretary: ['zhongshu', 'blocked'], zhongshu: ['zhongshu', 'blocked'] },
  zhongshu: { zhongshu: ['shangshu', 'blocked'], secretary: ['blocked'] },
  // 项目管理接单：要么自己开工（executing），要么把契约退回架构（zhongshu）。
  shangshu: { shangshu: ['executing', 'zhongshu', 'blocked'], secretary: ['blocked'] },
  // 项目经理自己干活，干完自己交审。
  executing: { shangshu: ['review', 'blocked'] },
  // 验收只有秘书（抽验）：轻量编制里没有第三方评审。
  review: { secretary: ['done', 'executing', 'blocked'] },
  ...RESULT_STAGES,
};

const CREW_STAGES = {
  draft: {
    secretary: ['zhongshu', 'blocked'],
    zhongshu: ['zhongshu', 'blocked'],
    menxia: ['blocked'],
    shangshu: ['blocked'],
    executor: ['blocked'],
  },
  zhongshu: {
    zhongshu: ['menxia', 'blocked'],
    menxia: ['zhongshu', 'blocked'],
    shangshu: ['blocked'],
    executor: ['blocked'],
    secretary: ['blocked'],
  },
  menxia: {
    menxia: ['shangshu', 'zhongshu', 'blocked'],
    zhongshu: ['blocked'],
    shangshu: ['blocked'],
    executor: ['blocked'],
    secretary: ['blocked'],
  },
  shangshu: {
    shangshu: ['executing', 'blocked'],
    zhongshu: ['blocked'],
    menxia: ['blocked'],
    executor: ['blocked'],
    secretary: ['blocked'],
  },
  executing: {
    executor: ['review', 'blocked'],
    shangshu: ['blocked'],
    menxia: ['blocked'],
    zhongshu: ['blocked'],
    secretary: ['blocked'],
  },
  review: {
    menxia: ['done', 'executing', 'blocked'],
    secretary: ['done', 'blocked'],
    executor: ['blocked'],
    shangshu: ['blocked'],
    zhongshu: ['blocked'],
  },
  ...RESULT_STAGES,
};

const LINE_STAGES = {
  draft: { secretary: ['zhongshu', 'blocked'], zhongshu: ['zhongshu', 'blocked'] },
  zhongshu: { zhongshu: ['shangshu', 'blocked'], secretary: ['blocked'] },
  shangshu: { shangshu: ['executing', 'zhongshu', 'blocked'], secretary: ['blocked'] },
  executing: { executor: ['review', 'blocked'], shangshu: ['blocked'] },
  // 批量任务的验收由派单人（项目经理）汇总，秘书可越级结项。
  review: { shangshu: ['done', 'executing', 'blocked'], secretary: ['done', 'blocked'] },
  ...RESULT_STAGES,
};

export const PIPELINES = {
  squad: SQUAD_STAGES,
  crew: CREW_STAGES,
  line: LINE_STAGES,
};

/** 未知/缺失一律按 crew 处理：宁可多一道评审，也不要把项目卡在表外。 */
export function shapeOf(project) {
  const shape = project?.shape;
  return SHAPES.includes(shape) ? shape : 'crew';
}

export function stagesOf(shape) {
  return PIPELINES[SHAPES.includes(shape) ? shape : 'crew'];
}

export function seatsOf(shape) {
  return SHAPE_META[SHAPES.includes(shape) ? shape : 'crew'].roles;
}

/** 该编制里这个省有没有席位（squad 没有评审与工程师）。 */
export function hasSeat(shape, role) {
  if (role === 'secretary' || role === 'user') return true;
  return seatsOf(shape).includes(role);
}

export function canTransition(from, role, to, shape = 'crew') {
  if (role === 'user') return true;
  if (!from || !to) return false;
  const allowed = stagesOf(shape)[from]?.[role];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function assertTransition(from, role, to, shape = 'crew') {
  if (canTransition(from, role, to, shape)) return;
  const meta = SHAPE_META[SHAPES.includes(shape) ? shape : 'crew'];
  throw new Error(
    `角色 ${role || 'unknown'} 不能把项目从 ${from || '?'} 改到 ${to || '?'}（编制：${meta.label}）`,
  );
}

/**
 * `court_update_project` 只处理“结果类”状态：blocked / review / done / archived。
 * 省与省之间的推进必须走 `court_handoff`，否则会出现“状态已变、会话没收到活”的幽灵项目。
 */
const BLOCKABLE = new Set(['draft', 'zhongshu', 'menxia', 'shangshu', 'executing', 'review', 'blocked']);

export function canUpdateStatus(from, role, to, shape = 'crew') {
  if (role === 'user') return true;
  const shapeKey = SHAPES.includes(shape) ? shape : 'crew';
  if (to === 'blocked') return BLOCKABLE.has(from);
  if (from === 'executing' && to === 'review') {
    // 轻量/批量编制没有独立工程师：干活的省自己交审。
    if (shapeKey === 'squad') return role === 'shangshu';
    return role === 'executor';
  }
  if (from === 'review' && to === 'executing') {
    if (shapeKey === 'squad') return role === 'secretary';
    return role === 'menxia';
  }
  if (from === 'review' && to === 'done') {
    return role === 'menxia' || role === 'secretary' || (shapeKey === 'line' && role === 'shangshu');
  }
  if (from === 'done' && to === 'archived') return role === 'secretary';
  return false;
}

export const BRIEF_KINDS = [
  'brief',
  'plan',
  'architecture',
  'contract',
  'quote',
  'package',
  'report',
  'acceptance',
  'change',
  'closing',
  'review',
  'verdict',
];

/** 模型常直接写中文类型名，这里做一次对照，剩下的才报错。 */
const BRIEF_KIND_ALIASES = {
  契约: 'contract',
  合同: 'contract',
  需求: 'contract',
  需求确认书: 'contract',
  需求书: 'contract',
  架构: 'architecture',
  技术方案: 'architecture',
  架构方案: 'architecture',
  方案: 'plan',
  报价: 'quote',
  报价单: 'quote',
  工单: 'package',
  任务包: 'package',
  交付说明: 'report',
  验收: 'acceptance',
  验收单: 'acceptance',
  变更: 'change',
  变更单: 'change',
  结项: 'closing',
  结项报告: 'closing',
  复审: 'review',
  结论: 'verdict',
  记录: 'brief',
  备忘: 'brief',
};

/**
 * 认不出来就报错，不再静默当成 brief。
 * 静默降级的后果很实在：契约被当成普通文书，3000 字预算跟着失效（回归实测遇到）。
 */
export function normalizeBriefKind(kind) {
  const raw = String(kind ?? 'brief').trim();
  const value = raw.toLowerCase();
  if (BRIEF_KINDS.includes(value)) return value;
  if (BRIEF_KIND_ALIASES[raw]) return BRIEF_KIND_ALIASES[raw];
  throw Object.assign(
    new Error(`未知的文书类型「${raw}」。可用：${BRIEF_KINDS.join(' / ')}`),
    { code: 'UNKNOWN_BRIEF_KIND' },
  );
}

const BRIEF_RULES = {
  plan: ['zhongshu'],
  architecture: ['zhongshu'],
  contract: ['zhongshu'],
  quote: ['zhongshu'],
  package: ['shangshu'],
  review: ['menxia'],
  verdict: ['menxia'],
  report: ['executor', 'shangshu'],
  acceptance: ['menxia', 'shangshu'],
  change: ['zhongshu'],
  closing: ['secretary'],
  brief: ['secretary', 'zhongshu', 'menxia', 'shangshu', 'executor'],
};

export function canSaveBrief(role, kind) {
  if (role === 'user') return true;
  let normalized = 'brief';
  try {
    normalized = normalizeBriefKind(kind);
  } catch {
    normalized = 'brief';
  }
  return (BRIEF_RULES[normalized] ?? BRIEF_RULES.brief).includes(role);
}

export function canSetWorkspace(role, status) {
  if (role === 'user') return true;
  if (role !== 'shangshu' && role !== 'secretary') return false;
  return ['draft', 'zhongshu', 'menxia', 'shangshu', 'blocked'].includes(status);
}

export function canSetChecks(role, status) {
  if (role === 'user') return true;
  if (role === 'zhongshu') return ['draft', 'zhongshu', 'blocked'].includes(status);
  if (role === 'shangshu') return ['shangshu', 'blocked'].includes(status);
  if (role === 'secretary') return ['draft', 'zhongshu', 'menxia', 'shangshu', 'blocked'].includes(status);
  return false;
}

export function canVerify(role) {
  return role === 'user' || ['executor', 'menxia', 'secretary'].includes(role);
}

export function canDiff(role) {
  return role === 'user' || ['executor', 'menxia', 'secretary'].includes(role);
}

export function canSubmitVerdict(role) {
  return role === 'menxia';
}

export function canConfirmScope(role) {
  return role === 'user' || role === 'secretary';
}

export function canRebaseWorkspace(role, status) {
  if (role === 'user') return true;
  if (role === 'secretary') return true;
  if (role === 'shangshu') return ['draft', 'zhongshu', 'menxia', 'shangshu', 'blocked'].includes(status);
  // 工程师只在已经开工/被路径卡住时允许“纠错式迁移”，并且必须写理由。
  return role === 'executor' && ['executing', 'blocked'].includes(status);
}
