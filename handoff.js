/**
 * 移交引擎：把项目从一省交到下一省。
 * 三个入口共用：agent 工具（court_handoff）、HTTP 路由（面板按钮）、秘书会话。
 */

import {
  ROLE_PRESET,
  makeId,
  num,
  progressOf,
  read,
  str,
  update,
} from './store.js';
import { baseName, openCourtSession, promptSession, service } from './sessions.js';
import { diffSnapshot, formatDiff, loadBaseline, saveBaseline, takeSnapshot } from './snapshot.js';
import { canSaveBrief, canTransition, hasSeat, seatsOf, shapeOf, SHAPE_META } from './auth.js';
import { lastVerification, summarizeChecks } from './checks.js';

import { AREA, roleLabel } from './brand.js';

export const ROLE_LABEL = {
  secretary: AREA.secretary,
  zhongshu: roleLabel('zhongshu'),
  menxia: roleLabel('menxia'),
  shangshu: roleLabel('shangshu'),
  executor: roleLabel('executor'),
};

/** 项目简称：会话标题用，避免「未命名」堆在一起。 */
export function shortName(name, max = 10) {
  const text = str(name).trim() || '项目';
  return text.length <= max ? text : text.slice(0, max) + '…';
}

export const HANDOFF_STATUS = {
  zhongshu: 'zhongshu',
  menxia: 'menxia',
  shangshu: 'shangshu',
  executor: 'executing',
};

const DEFAULT_TASK = {
  zhongshu: '请据此修订文书，处理完毕后再次 court_handoff 提交下一省。',
  menxia: '请先 court_submit_verdict：pass 则 court_handoff 到 shangshu，reject 则带最多 3 条 mustFix 并 court_handoff 回 zhongshu。',
  shangshu: '请确定工作区（必要时先问用户要现成目录），把契约拆成工单后 court_handoff 派活；轻量编制下由你自己执行。',
  executor: '请按文书执行，完成后用 court_update_project 勾掉对应里程碑，并简述交付物。',
};

import { buildIndex, briefPointer } from './context.js';
import { nextPackage, packageBrief } from './packages.js';
import { pickForContext } from './kb.js';

/** 只在正文确实很短时才内联；否则一律给指针，让接收方按需取。 */
function inlineOrPointer(brief, limit = 1200) {
  const content = str(brief?.content);
  if (!content) return '';
  if (content.length <= limit) return content;
  return briefPointer(brief);
}

export function handoffText(project, brief, from, to, note, planBrief, kbEntries) {
  const lines = [
    '【万象工阁 · 移交】',
    `项目：${project.name}（${project.id}）`,
    `来自：${ROLE_LABEL[from] ?? from}`,
    `移交至：${ROLE_LABEL[to] ?? to}`,
    `项目状态：${project.status}`,
    `编制：${SHAPE_META[shapeOf(project)]?.label ?? '完整岗位'}`,
    `席位：${seatsOf(shapeOf(project)).map((role) => ROLE_LABEL[role] ?? role).join(' → ')}`,
    project.rounds > 0 ? `驳回轮次：${project.rounds}` : '',
    '',
  ];
  if (brief) {
    lines.push(`—— 文书（${brief.kind}｜${brief.title}｜id=${brief.id}）——`, inlineOrPointer(brief), '');
  }
  if (to === 'executor' && planBrief && planBrief.id !== brief?.id) {
    lines.push(
      `—— 已批准方案（id=${planBrief.id}）——`,
      inlineOrPointer(planBrief),
      '',
      '注意：派工单若与上面这份已批准方案冲突（改需求、缩范围、换做法），以方案为准；',
      '发现冲突立刻 court_update_project 置 blocked 说明，不要自行取舍。',
      '',
    );
  }
  lines.push('—— 项目索引（指针，不是正文）——', buildIndex(project, { kbEntries }), '');
  if (to === 'executor') {
    const pkg = str(note).includes('工单：')
      ? null
      : nextPackage(project?.packages ?? []);
    if (pkg) {
      lines.push('—— 你这一张工单 ——', packageBrief(pkg), '');
    } else if (Array.isArray(project?.packages) && project.packages.length > 0) {
      lines.push('—— 工单 ——', '当前没有可开工的工单（依赖未合入或都已合入）：先问项目经理要下一张，不要自己挑。', '');
    }
  }
  lines.push('—— 你的任务 ——', note || DEFAULT_TASK[to] || '请按项目状态推进。', '');
  lines.push(
    '可用万象工阁工具：court_get_project（默认只给索引，view=work 给必要正文）、court_read_brief（读全文）、',
    'court_save_brief（写文书）、court_handoff（移交）、court_set_workspace（定工作区）、',
    'court_update_project（改状态/里程碑）、court_verify（跑验收/核文件）、court_diff（看 git diff）。',
  );
  return lines.filter((line) => line !== undefined && line !== null).join('\n');
}

function pickBrief(project, to) {
  const latest = (kind) => [...project.briefs].reverse().find((brief) => brief.kind === kind) ?? null;
  if (to === 'menxia') return latest('plan') ?? latest('brief');
  if (to === 'shangshu') return latest('plan') ?? latest('review') ?? latest('verdict');
  if (to === 'executor') return latest('brief') ?? latest('plan');
  if (to === 'zhongshu') return latest('verdict') ?? latest('plan');
  return latest('brief');
}

/**
 * 执行一次移交。
 * @returns {{sessionId: string, status: string, reused: boolean}}
 */
export async function performHandoff(ctx, {
  projectId,
  to,
  from = 'user',
  note,
  briefTitle,
  briefContent,
  workspacePath,
}) {
  if (!(to in ROLE_PRESET)) throw new Error(`未知目标省：${to}`);

  const state = await read();
  const project = state.projects[projectId];
  if (!project) throw new Error(`项目不存在：${projectId}`);

  const shape = shapeOf(project);
  const shapeLabel = SHAPE_META[shape]?.label ?? shape;
  if (!hasSeat(shape, to)) {
    throw new Error(`当前编制（${shapeLabel}）没有「${ROLE_LABEL[to] ?? to}」这个席位：要么把编制改成 crew，要么换一个下一步`);
  }
  const status = HANDOFF_STATUS[to];
  if (!canTransition(project.status, from, status, shape)) {
    throw new Error(`角色 ${from || 'unknown'} 不能把项目从 ${project.status} 移到 ${to}（编制：${shapeLabel}）`);
  }
  if (str(briefContent).trim() && !canSaveBrief(from, 'brief')) {
    throw new Error(`角色 ${from || 'unknown'} 不能在移交时写文书`);
  }
  if (from === 'menxia' && (to === 'shangshu' || to === 'executor')) {
    if (!project.latestVerdict
      || project.latestVerdict.decision !== 'pass'
      || project.latestVerdict.phase !== 'menxia') {
      throw new Error('评审放行前必须先 court_submit_verdict(pass, phase=menxia)');
    }
  }
  if (from === 'menxia' && to === 'zhongshu') {
    const cap = SHAPE_META[shapeOf(project)].rejectCap;
    if (project.rounds >= cap) {
      throw new Error(
        `已经驳回 ${project.rounds} 轮，达到本编制上限（${cap} 轮）：` +
        '停止自循环，把分歧交用户裁决（court_update_project 置 blocked，或改范围/降要求后重新立项）',
      );
    }
    if (!project.latestVerdict
      || project.latestVerdict.decision !== 'reject'
      || project.latestVerdict.phase !== 'menxia') {
      throw new Error('评审驳回前必须先 court_submit_verdict(reject, phase=menxia) 并给 mustFix');
    }
  }
  if (from !== 'user' && (to === 'shangshu' || to === 'executor')) {
    const scope = project.scope;
    if (scope && scope.drift && scope.confirmedAt < scope.drift.at) {
      throw new Error('方案相对已批准范围有 material 变更，用户尚未确认；先 court_confirm_scope 再派活');
    }
  }
  // G1「立项签字」：没有客户签字认可的范围，不许动手改代码。
  // v1.7 的漏洞是范围越漂越大、验收时才发现没人同意过；签字是唯一能事后追责的动作。
  if (to === 'executing' || to === 'executor') {
    if (num(project.scope && project.scope.confirmedAt) <= 0) {
      throw new Error(
        '还没签范围就开工了：先让客户（或秘书代签）用 court_confirm_scope 认可需求基线，'
        + '再 court_handoff 开工。签字记录会进 history，谁加的活谁认账。',
      );
    }
  }

  const brief = str(briefContent).trim()
    ? {
      id: makeId('b'),
      kind: 'brief',
      title: str(briefTitle, '移交文书'),
      summary: '',
      content: str(briefContent),
      author: from || 'court',
      createdAt: Date.now(),
    }
    : pickBrief(project, to);

  const projectDir = str(workspacePath) || (project.workspace && project.workspace.path) || '';
  const dirPath = projectDir || (to === 'executor' ? '' : (state.settings.courtWorkspace || ''));

  if (to === 'executor' && !dirPath) {
    throw new Error('项目管理还没定工作区：先 court_set_workspace，或本次传入 workspacePath。');
  }
  if (!dirPath) throw new Error('万象工阁工作区未配置');

  // 派活前确保有基线：哪怕项目管理是直接带路径派活的，也要能核对改动
  if (to === 'executor') {
    try {
      const existing = await loadBaseline(projectId);
      if (!existing) {
        const snapshot = await takeSnapshot(dirPath);
        await saveBaseline(projectId, snapshot);
      }
    } catch (error) {
      console.warn('[court] 派活前基线快照失败：', error?.message ?? error);
    }
  }

  const existingSession = project.departments[to] && project.departments[to].sessionId;
  let sessionId = existingSession;
  let reused = Boolean(existingSession);

  const approvedBrief = project.approvedBriefId
    ? project.briefs.find((item) => item.id === project.approvedBriefId) ?? null
    : [...project.briefs].reverse().find((item) => item.kind === 'plan') ?? null;

  if (!sessionId) {
    sessionId = await openCourtSession(ctx, {
      preset: ROLE_PRESET[to],
      dirPath,
      title: to === 'executor' ? baseName(dirPath) : '万象工阁',
      sessionTitle: `${shortName(project.name)} · ${ROLE_LABEL[to]}`,
    });
    reused = false;
  }

  const fromRole = from in project.departments ? from : null;
  const kbEntries = (await read()).kb?.entries || [];
  const injectedIds = pickForContext(kbEntries, project, 3).map((entry) => entry.id);
  const text = handoffText(project, brief, from, to, str(note), approvedBrief, kbEntries);
  const previousStatus = project.status;

  await update((current) => {
    const target = current.projects[projectId];
    if (!target) throw new Error(`项目不存在：${projectId}`);
    target.status = status;
    target.departments[to].sessionId = sessionId;
    target.departments[to].state = 'working';
    if (fromRole) target.departments[fromRole].state = 'done';
    if (to === 'zhongshu' && from === 'menxia') {
      target.rounds += 1;
      // 记账：驳回一轮就是一轮返工，报价里的轮次预算要靠它对照
      if (target.actual && typeof target.actual === 'object') target.actual.rounds += 1;
    }
    if (brief && !target.briefs.some((b) => b.id === brief.id)) {
      brief.author = from || 'court';
      target.briefs.push(brief);
    }
    if (to === 'shangshu') {
      // 评审通过时锁定「已批准方案」，后面派工必须引用它
      target.approvedBriefId = (brief && brief.kind === 'plan' ? brief.id : approvedBrief && approvedBrief.id) || null;
    }
    const tick = (keyword) => {
      const milestone = target.milestones.find((m) => m.title.includes(keyword));
      if (milestone && !milestone.done) {
        milestone.done = true;
        milestone.doneAt = Date.now();
      }
    };
    if (to === 'menxia') {
      tick('需求');
      tick('方案');
    }
    if (to === 'shangshu') tick('评审审核');
    if (to === 'executor') {
      if (str(workspacePath) && (!target.workspace || target.workspace.path !== dirPath)) {
        target.workspace = { id: '', path: dirPath };
      }
      target.executorStartedAt = Date.now();
      target.deliveryDiff = null;
      target.latestVerdict = null;
    }
    if (status !== previousStatus) {
      target.history.push({
        at: Date.now(),
        from: previousStatus,
        to: status,
        by: from || 'unknown',
        note: str(note),
        reportId: null,
      });
    }
    target.updatedAt = Date.now();
    // 记忆命中记账：被注入到移交提示词里的条目 hits+1，将来用它判断哪条真有用
    if (injectedIds.length > 0 && current.kb?.entries) {
      for (const entry of current.kb.entries) {
        if (injectedIds.includes(entry.id)) entry.hits += 1;
      }
    }
    current.pendingJump = {
      seq: current.seq + 1,
      projectId,
      sessionId,
      to,
      label: `${target.name} · ${ROLE_LABEL[to]}`,
      createdAt: Date.now(),
    };
  });

  try {
    await promptSession(ctx, sessionId, text);
  } catch (error) {
    await update((current) => {
      const target = current.projects[projectId];
      if (target) {
        target.lastNote = `移交投递失败：${error?.message ?? String(error)}`;
        target.updatedAt = Date.now();
      }
    });
    throw error;
  }

  return { sessionId, status, reused };
}

/**
 * 向秘书说话：没有秘书会话就开一个，有就复用，然后把话投进去。
 * @returns {{sessionId: string, reused: boolean}}
 */
export async function talkToSecretary(ctx, text) {
  const message = str(text).trim();
  if (!message) throw new Error('要说点什么');

  const state = await read();
  const courtWorkspace = state.settings.courtWorkspace;
  if (!courtWorkspace) throw new Error('万象工阁工作区未配置');

  let sessionId = state.settings.secretarySessionId || null;
  let reused = Boolean(sessionId);

  const openSecretary = async () => {
    const created = await openCourtSession(ctx, {
      preset: 'court-secretary',
      dirPath: courtWorkspace,
      title: '万象工阁',
      sessionTitle: '接单台',
    });
    await update((current) => {
      current.settings.secretarySessionId = created;
    });
    return created;
  };

  if (!sessionId) {
    sessionId = await openSecretary();
    reused = false;
  }

  // 已归档的会话会被 DSH 的 ArchivedSessionGate 直接判 blocked：消息虽然
  // accepted，但 turn 一步都不跑。投递前先解档，避免“秘书没收到”的假象。
  const workspaceRegistry = service(ctx, 'workspaceRegistry');
  if (workspaceRegistry && typeof workspaceRegistry.unarchiveSession === 'function') {
    try {
      await workspaceRegistry.unarchiveSession(sessionId);
    } catch (error) {
      console.warn('[court] 秘书会话解档失败：', error?.message ?? error);
    }
  }

  try {
    await promptSession(ctx, sessionId, message);
  } catch (error) {
    if (!reused) throw error;
    // 旧秘书会话可能已被归档/删除，或宿主重启后已不在：开一个新的再投一次，
    // 不要让「手动立项」因为一条过期 sessionId 而静默失败。
    console.warn('[court] 旧秘书会话投递失败，改开新会话：', error?.message ?? error);
    sessionId = await openSecretary();
    reused = false;
    await promptSession(ctx, sessionId, message);
  }
  return { sessionId, reused };
}

// ---------------------------------------------------------------------------
// 按铃：状态变化时叫醒该管这件事的那一方
// ---------------------------------------------------------------------------

function verificationLine(verification) {
  if (!verification) return '（本项目还没有跑过验收命令）';
  const checks = summarizeChecks(verification);
  if (checks.length === 0) return '（本项目没有登记验收命令；只能核对文件/哈希）';
  const parts = checks.map((check) => `${check.id}=${check.ok ? 'PASS' : 'FAIL'}（exit ${check.exit_code}，${check.duration_ms}ms）`);
  return `验证 ${verification.id}：${verification.ok ? '全部通过' : '存在失败'}；${parts.join('；')}`;
}

function reviewText(project, diff, verification, round = 1) {
  return [
    '【万象工阁 · 交付复核】',
    `项目「${project.name}」（${project.id}）已由工程师交付，第 ${round} 轮复核。`,
    '这一步由评审做交付复核，不是项目管理自评，也不是工程师自评。',
    '',
    '本轮的干净上下文只给你必要材料；不要要求把全部历史文书重发一遍：',
    '1. court_get_project 用 view=work（默认 index 只有索引）读取已批准方案、本次 report、里程碑、checks；',
    '2. 需要方案/报告全文时用 court_read_brief；',
    '3. 工作区是 git 仓库时用 court_diff 看真正的 diff；',
    '4. 有登记 checks 时用 court_verify 独立重跑（不要只信工程师的自述）。',
    '',
    `—— 本次改动（相对开工基线）——`,
    formatDiff(diff),
    '',
    `—— 验收命令 ——`,
    verificationLine(verification),
    '',
    '然后逐条核对：',
    '1. 交付物是否真的存在、能否验证；',
    '2. 是否逐条满足方案里的验收标准；',
    '3. 工程师 report 里的自述与本次改动、验收命令结果是否一致；',
    '4. 顺序合规：history 里 review 那条必须带 report_id，且对应 report 的 createdAt 不得晚于该条 at。',
    '   若 report_id 为空、或 report 比状态变更还晚，直接判不合格。',
    '',
    '结论只能二选一：',
    '· 合格 → 先 court_submit_verdict(decision="pass", phase="review")，再 court_update_project 置 status=done；',
    '· 不合格 → 先 court_submit_verdict(decision="reject", phase="review", mustFix=[最多 3 条])，再 court_update_project 置 status=executing。',
    '',
    '注意：本次改动里出现方案没允许的文件，即使成品看着对也要判不合格。',
    '你不能改方案，也不要替工程师动手；只给结论和依据。',
  ].join('\n');
}

function reworkText(project) {
  const verification = lastVerification(project);
  const failed = verification && !verification.ok
    ? (verification.checks || []).filter((check) => !check.ok)
      .map((check) => `- ${check.id}（exit ${check.exitCode}）：${(check.stderrTail || check.stdoutTail || '').slice(-800)}`)
      .join('\n')
    : '';
  return [
    '【万象工阁 · 返工】',
    `项目「${project.name}」验收未通过。`,
    '',
    '返工要求：',
    project.lastNote || '（评审没写明具体问题，请先 court_get_project view=work 读项目再判断）',
    failed ? `\n验收命令失败项：\n${failed}` : '',
    '',
    '请按此修改，完成后重新跑 court_verify，再 court_update_project 置 status=review 再次交验收。',
  ].join('\n');
}

function doneText(project) {
  return [
    '【万象工阁 · 结项】',
    `项目「${project.name}」已通过验收并结项，进度 ${progressOf(project)}%。`,
    '未完成的里程碑会保留原样，不再自动标成完成；需要的话请在项目详情里处理。',
    '',
    '请向用户一句话汇报：这次交付了什么、关键产出在哪、有没有遗留问题。不要写长篇总结。',
  ].join('\n');
}

/** 叫醒某个角色（复用它的既有会话；没有会话就跳过，不新开）。 */
export async function wakeRole(ctx, projectId, role, text) {
  const state = await read();
  const project = state.projects[projectId];
  if (!project) return false;
  const sessionId = role === 'secretary'
    ? state.settings.secretarySessionId
    : (project.departments[role] && project.departments[role].sessionId);
  if (!sessionId) return false;
  await promptSession(ctx, sessionId, text);
  return true;
}

/**
 * 交付复核用干净上下文：每轮新开一个评审会话，只投递 review packet。
 * 旧会话不删，留给会话清理；失败时回退到旧会话，避免项目卡死。
 */
async function startReview(ctx, projectId, diff) {
  const state = await read();
  const project = state.projects[projectId];
  if (!project) return false;
  const courtWorkspace = state.settings.courtWorkspace;
  if (!courtWorkspace) return false;
  const reviewWorkspace = (project.workspace && project.workspace.path) || courtWorkspace;

  const previousSession = project.departments.menxia.sessionId || null;
  const round = (project.reviewRound || 0) + 1;
  let sessionId;
  try {
    sessionId = await openCourtSession(ctx, {
      preset: 'court-menxia',
      dirPath: reviewWorkspace,
      title: '万象工阁',
      sessionTitle: `${shortName(project.name)} · 评审 · 第${round}轮`,
    });
  } catch (error) {
    console.warn('[court] 新开复核会话失败：', error?.message ?? error);
    return false;
  }

  await update((current) => {
    const target = current.projects[projectId];
    if (!target) return;
    target.departments.menxia.sessionId = sessionId;
    target.departments.menxia.state = 'reviewing';
    target.updatedAt = Date.now();
  });

  try {
    await promptSession(ctx, sessionId, reviewText(project, diff, lastVerification(project), round));
  } catch (error) {
    console.warn('[court] 复核投递失败：', error?.message ?? error);
    await update((current) => {
      const target = current.projects[projectId];
      if (!target) return;
      target.departments.menxia.sessionId = previousSession;
      target.departments.menxia.state = 'idle';
      target.lastNote = `复核投递失败：${error?.message ?? String(error)}`;
      target.updatedAt = Date.now();
    });
    return false;
  }

  await update((current) => {
    const target = current.projects[projectId];
    if (!target) return;
    target.reviewRound = round;
    if (previousSession) {
      target.retiredSessions.push(previousSession);
      target.retiredSessions = target.retiredSessions.slice(-50);
    }
    target.updatedAt = Date.now();
  });
  return true;
}

/**
 * 状态变化后的回调（“按铃”）。
 * 投递失败只记日志，绝不让它把状态变更本身弄失败。
 */
export async function onStatusChanged(ctx, { projectId, from, to }) {
  if (!to || from === to) return;
  try {
    const state = await read();
    const project = state.projects[projectId];
    if (!project) return;

    if (to === 'review') {
      const workspacePath = project.workspace && project.workspace.path;
      let diff = null;
      if (workspacePath) {
        try {
          const baseline = await loadBaseline(projectId);
          diff = await diffSnapshot(workspacePath, baseline);
        } catch (error) {
          console.warn('[court] 交付对比失败：', error?.message ?? error);
        }
      }

      await update((current) => {
        const target = current.projects[projectId];
        if (!target) return;
        target.departments.menxia.state = 'reviewing';
        target.departments.shangshu.state = 'done';
        if (diff) target.deliveryDiff = diff;
        target.updatedAt = Date.now();
      });

      const started = await startReview(ctx, projectId, diff);
      if (!started) {
        const woken = await wakeRole(ctx, projectId, 'menxia', reviewText(project, diff, lastVerification(project)));
        if (!woken) {
          await update((current) => {
            const target = current.projects[projectId];
            if (!target) return;
            target.lastNote = '复核会话不可用：请人工打开/新建评审会话，或把项目置 blocked 后处理。';
            target.updatedAt = Date.now();
          });
        }
      }
      return;
    }
    if (to === 'executing' && from === 'review') {
      // 打回时把「施工/交付」和「评审」里程碑一起退回未完成，进度条跟着回落
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) return;
        for (const milestone of target.milestones) {
          const reworkable = milestone.title.includes('施工')
            || milestone.title.includes('执行')
            || milestone.title.includes('交付')
            || milestone.title.includes('评审')
            || milestone.title.includes('评审');
          if (milestone.done && reworkable) {
            milestone.done = false;
            milestone.doneAt = null;
          }
        }
      });
      await wakeRole(ctx, projectId, 'executor', reworkText(project));
      return;
    }
    if (to === 'done') {
      await update((current) => {
        const target = current.projects[projectId];
        if (!target) return;
        target.departments.shangshu.state = 'idle';
        target.departments.executor.state = 'done';
        target.departments.menxia.state = 'done';
        target.completedAt = Date.now();
        // 不再把未完成里程碑强制标成 done：结项是结论，不是篡改进度。
      });
      await wakeRole(ctx, projectId, 'secretary', doneText(project));
    }
  } catch (error) {
    console.warn('[court] 状态回调投递失败：', error?.message ?? error);
  }
}
