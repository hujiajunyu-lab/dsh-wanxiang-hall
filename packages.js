/**
 * 工单（packages）与派活（Step 3）
 *
 * 并行最容易翻车的不是模型笨，是**两个人同时改同一个文件**：
 * A 改了 Header.jsx 的按钮，B 同时重写了同一段，最后合并时谁都不认。
 * 所以「并行」必须建立在两个数据之上：
 *   1. 每个工单声明它要改哪些文件（files）；
 *   2. 两个工单只要有文件重叠，就必须有先后（dependsOn），否则不许同时开工。
 *
 * 这里全是纯函数，便于测试；真正的状态落库在 store 的 project.packages。
 */

export const PACKAGE_STATES = ['queued', 'doing', 'ready', 'merged', 'blocked'];
export const ACTIVE_STATES = new Set(['queued', 'doing', 'ready']);

function norm(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** 通配符之前的静态前缀：`src/api/**\/*.js` → `src/api/`。 */
function staticPrefix(pattern) {
  const raw = norm(pattern);
  const star = raw.indexOf('*');
  return star < 0 ? raw : raw.slice(0, star);
}

/** 两条文件声明是否可能指向同一个文件。宁可多报冲突，也不要合并时才发现。 */
export function pathsConflict(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`)) return true;
  if (!na.includes('*') && !nb.includes('*')) return false;
  const pa = staticPrefix(na);
  const pb = staticPrefix(nb);
  if (!pa || !pb) return true; // 纯通配符（如 *.js）视为与一切冲突
  return pa.startsWith(pb) || pb.startsWith(pa);
}

/** A 是否直接或间接依赖 B。 */
function dependsOn(pkg, targetId, all, seen = new Set()) {
  const deps = Array.isArray(pkg?.dependsOn) ? pkg.dependsOn : [];
  for (const dep of deps) {
    if (dep === targetId) return true;
    if (seen.has(dep)) continue;
    seen.add(dep);
    const next = all.find((item) => item.id === dep);
    if (next && dependsOn(next, targetId, all, seen)) return true;
  }
  return false;
}

/**
 * 拆完工单先跑这个：错误必须挡住派活，警告可以让项目经理自己判断。
 * 检查内容：id 重复、依赖指向不存在、循环依赖、并行工单文件重叠、缺验收标准。
 */
export function validatePackages(packages) {
  const list = Array.isArray(packages) ? packages : [];
  const errors = [];
  const warnings = [];
  const ids = new Set();

  for (const pkg of list) {
    const id = norm(pkg?.id);
    if (!id) {
      errors.push('有工单没有 id');
      continue;
    }
    if (ids.has(id)) errors.push(`工单 id 重复：${id}`);
    ids.add(id);
    if (!norm(pkg?.title)) errors.push(`工单 ${id} 没有标题`);
    if (!Array.isArray(pkg?.files) || pkg.files.length === 0) {
      warnings.push(`工单 ${id} 没声明要改哪些文件，无法判断并行安全性`);
    }
    if (!Array.isArray(pkg?.dod) || pkg.dod.length === 0) {
      warnings.push(`工单 ${id} 没写完成标准（dod），验收时只能靠感觉`);
    }
  }

  for (const pkg of list) {
    for (const dep of Array.isArray(pkg?.dependsOn) ? pkg.dependsOn : []) {
      if (!ids.has(dep)) errors.push(`工单 ${pkg.id} 依赖了不存在的工单：${dep}`);
      if (dep === pkg.id) errors.push(`工单 ${pkg.id} 依赖了自己`);
    }
  }

  // 循环依赖
  for (const pkg of list) {
    if (dependsOn(pkg, pkg.id, list)) errors.push(`工单 ${pkg.id} 处在循环依赖里`);
  }

  // 并行冲突：两个可能同时活跃的工单，文件有重叠，又没有先后关系
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (!ACTIVE_STATES.has(a.state) || !ACTIVE_STATES.has(b.state)) continue;
      if (dependsOn(a, b.id, list) || dependsOn(b, a.id, list)) continue;
      const filesA = Array.isArray(a.files) ? a.files : [];
      const filesB = Array.isArray(b.files) ? b.files : [];
      const clash = filesA.some((fa) => filesB.some((fb) => pathsConflict(fa, fb)));
      if (clash) {
        errors.push(`工单 ${a.id} 与 ${b.id} 会改到同一批文件，却没有先后依赖：加 dependsOn，或把文件拆开`);
      }
    }
  }

  return { errors, warnings };
}

/** 现在可以开工的工单：自己的依赖全部已合入。 */
export function readyPackages(packages) {
  const list = Array.isArray(packages) ? packages : [];
  return list.filter((pkg) => {
    if (pkg.state !== 'queued') return false;
    const deps = Array.isArray(pkg.dependsOn) ? pkg.dependsOn : [];
    return deps.every((dep) => list.find((item) => item.id === dep)?.state === 'merged');
  });
}

/** 下一个该干的工单（按顺序取第一个就绪的）。 */
export function nextPackage(packages) {
  return readyPackages(packages)[0] ?? null;
}

/** 一句话进度，给面板和索引共用。 */
export function describePackages(packages) {
  const list = Array.isArray(packages) ? packages : [];
  if (list.length === 0) return '未拆工单';
  const count = (state) => list.filter((pkg) => pkg.state === state).length;
  const parts = [`共 ${list.length}`];
  for (const state of ['doing', 'ready', 'merged', 'blocked', 'queued']) {
    const n = count(state);
    if (n > 0) parts.push(`${state} ${n}`);
  }
  const next = nextPackage(list);
  return next ? `${parts.join('／')}；下一个：${next.id}` : parts.join('／');
}

/** 给执行者的工单正文（不含整篇方案，方案走指针）。 */
export function packageBrief(pkg) {
  if (!pkg) return '';
  const lines = [
    `工单：${pkg.id}｜${pkg.title}`,
    pkg.goal ? `目标：${pkg.goal}` : '',
    Array.isArray(pkg.files) && pkg.files.length > 0
      ? `只许改：${pkg.files.join('、')}`
      : '只许改：未声明（先问项目经理）',
    Array.isArray(pkg.dod) && pkg.dod.length > 0
      ? `完成标准：\n${pkg.dod.map((item) => `- ${item}`).join('\n')}`
      : '完成标准：未写（先问项目经理）',
    Array.isArray(pkg.dependsOn) && pkg.dependsOn.length > 0
      ? `依赖：${pkg.dependsOn.join('、')}（已合入才能开工）`
      : '',
    '改到「只许改」以外的文件＝越界，验收会被挡；确实需要改，先回报项目经理加进工单。',
  ].filter(Boolean);
  return lines.join('\n');
}
