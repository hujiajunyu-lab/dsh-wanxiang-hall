/**
 * 手动探针：拿真实的 court.json 跑一遍心跳，看面板会怎么显示。
 * 不是测试（不打 .test.js 后缀），用 `node test/probe-live.mjs` 手动跑。
 */

import { read } from '../store.js';
import { healthOf, stampOf, describeHealth, STAGE_ROLE } from '../activity.js';

const state = await read();
const now = Date.now();
const rows = [];

for (const project of Object.values(state.projects)) {
  const role = STAGE_ROLE[project.status];
  if (!role) continue;
  const sessionId = project.departments?.[role]?.sessionId || null;
  const stamp = sessionId ? stampOf(sessionId, now) : null;
  const health = healthOf(project, { now, stamp });
  rows.push({
    项目: project.name,
    状态: project.status,
    环节: role,
    会话: sessionId ? sessionId.slice(0, 8) : '—',
    心跳: health.state,
    显示: describeHealth(health, project),
    '会话文件': stamp ? `${Math.round(stamp.bytes / 1024)}KB` : '未找到',
  });
}

if (rows.length === 0) {
  console.log('（没有停在流水线上的项目）');
} else {
  console.table(rows);
}

// 全项目：每个部门的会话能不能对上一个真实的会话日志
const all = [];
for (const project of Object.values(state.projects)) {
  const depts = Object.entries(project.departments || {})
    .filter(([, dept]) => dept && dept.sessionId)
    .map(([roleName, dept]) => {
      const stamp = stampOf(dept.sessionId, now);
      return `${roleName}:${stamp ? `${Math.round((now - stamp.at) / 60000)}min` : '✗'}`;
    });
  all.push({
    项目: project.name,
    状态: project.status,
    '文书/回合': `${(project.briefs || []).length}/${project.rounds || 0}`,
    '最后写文书': project.updatedAt ? `${Math.round((now - project.updatedAt) / 60000)}min` : '—',
    会话: depts.join(' ') || '—',
  });
}
console.table(all);

// 顺带把索引规模报出来，确认扫描没漏
const { rebuildIndex } = await import('../activity.js');
console.log(`索引到 ${rebuildIndex().size} 个会话日志`);
