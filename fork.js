/**
 * 承接立项（lineage）—— 同一个仓库的下一步，不用从零再摸一遍。
 *
 * 病因（v2.1 Step 2 之前）：每次立项都是白纸，架构师要重新读目录、重新问技术栈、
 * 重新登记一遍验收命令；同一仓库的第二轮需求，光「重新认识这个项目」就烧掉大半预算。
 *
 * 这里只做纯计算：给定父项目和参数，算出子项目该继承什么、复用哪些会话。
 * 落库与权限检查留在 tools.js。
 */

import { normalizeProject, num, str } from './store.js';
import { seatsOf, shapeOf, SHAPES } from './auth.js';

/** 子项目能继承的东西：都是「关于这个仓库的知识」，不是「上一轮的任务」。 */
const INHERITED_KEYS = ['workspace', 'context', 'ownership', 'checks', 'references'];

export function buildFork(parent, options = {}) {
  if (!parent || !parent.id) throw new Error('被承接的项目不存在');
  const name = str(options.name).trim();
  if (!name) throw new Error('项目名不能为空');

  const now = num(options.now, Date.now());
  const shape = SHAPES.includes(str(options.shape)) ? str(options.shape) : shapeOf(parent);
  const reuseSessions = options.reuseSessions !== false;
  const id = str(options.id).trim() || `p_${now.toString(36)}`;

  // 只复用「新编制里还有这个席位」的会话：squad 的 shangshu 会话在 crew 里不能用，
  // 因为 crew 的 shangshu 是 PM（派活），squad 的 shangshu 是干活的工程师。
  const departments = {};
  const linkedSessions = [];
  if (reuseSessions) {
    for (const role of seatsOf(shape)) {
      const dept = parent.departments?.[role];
      if (!dept || !dept.sessionId) continue;
      departments[role] = {
        sessionId: dept.sessionId,
        state: 'idle',
        note: `承接自 ${parent.name}`,
        inherited: true,
      };
      linkedSessions.push({
        role,
        sessionId: dept.sessionId,
        projectId: parent.id,
        inherited: true,
      });
    }
  }

  const project = normalizeProject(id, {
    name,
    description: str(options.description).trim() || `承接「${parent.name}」的后续工作`,
    status: 'draft',
    shape,
    vaultAccess: parent.vaultAccess,
    workspace: parent.workspace && parent.workspace.path
      ? { id: parent.workspace.id || '', path: parent.workspace.path }
      : null,
    lineage: { parentId: parent.id, name: parent.name, kind: 'clone', at: now },
    context: parent.context,
    ownership: parent.ownership,
    checks: options.inheritChecks === false ? [] : parent.checks,
    packages: [],
    references: parent.references,
    linkedSessions,
    departments,
    createdAt: now,
    updatedAt: now,
    milestones: (parent.milestones || []).map((item, index) => ({
      id: `m${index + 1}`,
      title: item.title || `里程碑 ${index + 1}`,
      weight: num(item.weight, 10),
    })),
  });

  return {
    project,
    inherited: summarize(parent, project),
    reusedSessions: linkedSessions.length,
  };
}

/** 给人看的一句话：到底省下了哪些重新认识成本。 */
export function summarize(parent, child) {
  const parts = [];
  if (child.workspace && child.workspace.path) parts.push('工作区');
  const ctx = child.context || {};
  if (ctx.map || ctx.stack) parts.push('结构/技术栈');
  if ((child.ownership || []).length) parts.push(`${child.ownership.length} 条文件归属`);
  if ((child.checks || []).length) parts.push(`${child.checks.length} 条验收命令`);
  if ((child.linkedSessions || []).length) parts.push(`${child.linkedSessions.length} 个会话`);
  if (parts.length === 0) return '只有项目记录';
  return parts.join('、');
}

export { INHERITED_KEYS };
