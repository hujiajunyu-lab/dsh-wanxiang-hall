/**
 * 文件归属与越界审计（Step 3）
 *
 * 并行/外包最怕的不是写得慢，是**改到不该改的文件**：别人的模块、构建产物、
 * 配置文件、隐私文件。所以「谁改哪些文件」必须是数据，不是口头约定。
 *
 * ownership 条目（project.ownership）与 package.files 用同一套极简 glob：
 *   src/api/**       目录下全部
 *   **\/*.test.js    任意层级的测试
 *   *.md             仓库根的 markdown
 *   package.json     精确路径
 * 不支持的写法直接判为「不匹配」，宁可多报越界，也不静默放过。
 */

function norm(p) {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function toRegex(pattern) {
  const segs = norm(pattern).split('/');
  let out = '^';
  segs.forEach((seg, index) => {
    const isLast = index === segs.length - 1;
    if (seg === '**') {
      out += isLast ? '.*' : '(?:.*/)?';
      return;
    }
    out += seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    if (!isLast) out += '/';
  });
  return new RegExp(`${out}$`);
}

/** 一条模式是否命中一个相对路径。 */
export function matchPattern(file, pattern) {
  const rel = norm(file);
  const raw = norm(pattern);
  if (!rel || !raw) return false;
  if (raw.endsWith('/')) return rel.startsWith(raw);
  if (raw.endsWith('/**')) {
    const prefix = raw.slice(0, -3);
    return rel === prefix || rel.startsWith(`${prefix}/`);
  }
  if (raw.includes('*')) {
    // `*` 不跨层级（[^/]*），`**` 才跨层级；根级 *.md 因此天然只匹配根目录
    return toRegex(raw).test(rel);
  }
  return rel === raw || rel.startsWith(`${raw}/`);
}

/** 项目声明的归属：ownership ∪ 各工单的 files。 */
export function ownedPatterns(project) {
  const patterns = [];
  for (const item of Array.isArray(project?.ownership) ? project.ownership : []) {
    const pattern = norm(typeof item === 'string' ? item : item?.pattern);
    if (pattern) patterns.push(pattern);
  }
  for (const pkg of Array.isArray(project?.packages) ? project.packages : []) {
    for (const file of Array.isArray(pkg?.files) ? pkg.files : []) {
      const pattern = norm(file);
      if (pattern) patterns.push(pattern);
    }
  }
  return [...new Set(patterns)];
}

export function isOwned(file, patterns) {
  return patterns.some((pattern) => matchPattern(file, pattern));
}

/**
 * 越界审计：把改动分成「声明的」「没声明的」两栏。
 * 没有声明任何归属时，全部算 unowned —— 让用户看见「这个项目根本没说清楚谁能改什么」。
 */
export function auditChanges(project, changed = []) {
  const patterns = ownedPatterns(project);
  const inScope = [];
  const outOfScope = [];
  for (const file of changed) {
    const rel = norm(file);
    if (!rel) continue;
    if (isOwned(rel, patterns)) inScope.push(rel);
    else outOfScope.push(rel);
  }
  return {
    declared: patterns.length,
    inScope,
    outOfScope,
    verdict: outOfScope.length === 0 ? 'ok' : (patterns.length === 0 ? 'undeclared' : 'out-of-scope'),
  };
}

/** 给人看的一行结论。 */
export function describeAudit(audit) {
  if (!audit) return '';
  if (audit.verdict === 'ok') return `改动 ${audit.inScope.length} 个文件，全部在归属内`;
  if (audit.verdict === 'undeclared') {
    return `改动 ${audit.outOfScope.length} 个文件，但项目没有声明文件归属（先 court_set_ownership）`;
  }
  return `越界 ${audit.outOfScope.length} 个文件：${audit.outOfScope.slice(0, 5).join('、')}`;
}
