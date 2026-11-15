import test from 'node:test';
import assert from 'node:assert/strict';

import { auditChanges, describeAudit, isOwned, matchPattern, ownedPatterns } from '../ownership.js';

test('matchPattern：目录前缀与 /** 等价', () => {
  assert.equal(matchPattern('src/api/user.js', 'src/api/**'), true);
  assert.equal(matchPattern('src/api/user.js', 'src/api'), true);
  assert.equal(matchPattern('src/apix/user.js', 'src/api'), false);
});

test('matchPattern：** 跨层级，* 不跨层级', () => {
  assert.equal(matchPattern('a/b/c/d.test.js', '**/*.test.js'), true);
  assert.equal(matchPattern('d.test.js', '**/*.test.js'), true);
  assert.equal(matchPattern('src/d.test.js', 'src/*.test.js'), true);
  assert.equal(matchPattern('src/x/d.test.js', 'src/*.test.js'), false);
});

test('matchPattern：根级 *.md 只管根目录', () => {
  assert.equal(matchPattern('README.md', '*.md'), true);
  assert.equal(matchPattern('docs/README.md', '*.md'), false);
});

test('matchPattern：精确文件与反斜杠路径', () => {
  assert.equal(matchPattern('package.json', 'package.json'), true);
  assert.equal(matchPattern('src\\index.js', 'src/index.js'), true);
  assert.equal(matchPattern('package-lock.json', 'package.json'), false);
});

test('ownedPatterns：合并 ownership 与工单 files 并去重', () => {
  const patterns = ownedPatterns({
    ownership: ['src/api/**', { pattern: 'src/ui/**' }, 'src/api/**'],
    packages: [{ files: ['src/api/user.js'] }, { files: [] }],
  });
  assert.deepEqual(patterns, ['src/api/**', 'src/ui/**', 'src/api/user.js']);
});

test('auditChanges：越界要单独列出', () => {
  const audit = auditChanges({ ownership: ['src/api/**'] }, [
    'src/api/user.js',
    'src/ui/App.jsx',
    'package.json',
  ]);
  assert.equal(audit.verdict, 'out-of-scope');
  assert.deepEqual(audit.inScope, ['src/api/user.js']);
  assert.deepEqual(audit.outOfScope, ['src/ui/App.jsx', 'package.json']);
});

test('auditChanges：没声明归属时判 undeclared，而不是假装全过', () => {
  const audit = auditChanges({}, ['a.js']);
  assert.equal(audit.verdict, 'undeclared');
  assert.deepEqual(audit.outOfScope, ['a.js']);
  assert.match(describeAudit(audit), /没有声明文件归属/);
});

test('auditChanges：全部在归属内才 ok', () => {
  const audit = auditChanges({ ownership: ['src/**'] }, ['src/a.js', 'src/b/c.js']);
  assert.equal(audit.verdict, 'ok');
  assert.match(describeAudit(audit), /全部在归属内/);
});

test('isOwned：空模式列表一律不命中', () => {
  assert.equal(isOwned('a.js', []), false);
});
