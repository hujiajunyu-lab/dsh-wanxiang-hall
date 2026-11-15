/**
 * 万象工阁 · 对外名称的唯一出处。
 *
 * 公司：幻盏　团队：万象幻容　插件：万象工阁
 *
 * 内部 role id 一律保持 zhongshu / menxia / shangshu / executor 不变——
 * 改的是显示层，不是数据。v1.7 以来的 court.json、会话标题、测试断言都不受影响。
 */

export const BRAND = {
  name: '万象工阁',
  en: 'Wanxiang Gongge',
  company: '幻盏',
  team: '万象幻容',
  tagline: '接单、排期、开工、验收、交付：一个人的公司，五个人的产出。',
};

/** 角色显示名（默认形态）。 */
export const ROLE_TITLE = {
  zhongshu: '架构师',
  menxia: '评审',
  shangshu: '项目经理',
  executor: '工程师',
  secretary: '交付秘书',
  user: '客户',
  dsh: '客户',
};

/** 同一席位在不同编制下的叫法：轻量组只有一个人，他既是 PM 也是工程师。 */
export const ROLE_BY_SHAPE = {
  squad: { shangshu: '交付工程师' },
  line: { shangshu: '工单调度' },
};

/** 面板四个入口。 */
export const AREA = {
  secretary: '接单台',
  chancellery: '工位',
  hall: '项目看板',
  scriptorium: '知识库',
};

export const SHAPE_LABEL = { squad: '轻量组', crew: '项目组', line: '流水线' };

export const SHAPE_LONG = {
  squad: '轻量组 · 架构师＋交付工程师',
  crew: '项目组 · 架构师＋评审＋PM＋工程师',
  line: '流水线 · 模板＋工单池',
};

export function shapeLabel(shape) {
  return SHAPE_LABEL[shape] || SHAPE_LABEL.crew;
}

export function shapeLong(shape) {
  return SHAPE_LONG[shape] || SHAPE_LONG.crew;
}

/** role + 编制 → 显示名。 */
export function roleLabel(role, shape) {
  if (!role) return '未指派';
  const override = ROLE_BY_SHAPE[shape || 'crew'] || {};
  if (override[role]) return override[role];
  return ROLE_TITLE[role] || role;
}

/** 「架构师（zhongshu）」这种拿给工具描述看的写法。 */
export function roleWithId(role, shape) {
  return `${roleLabel(role, shape)}（${role}）`;
}
