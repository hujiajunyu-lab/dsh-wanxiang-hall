import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describePackages,
  nextPackage,
  packageBrief,
  pathsConflict,
  readyPackages,
  validatePackages,
} from '../packages.js';

const pkg = (over = {}) => ({
  id: 'k1',
  title: '改首页',
  files: ['src/pages/home/**'],
  dod: ['首屏 1 秒内打开'],
  state: 'queued',
  dependsOn: [],
  ...over,
});

test('pathsConflict：同文件、父子目录、通配前缀都算冲突', () => {
  assert.equal(pathsConflict('src/a.js', 'src/a.js'), true);
  assert.equal(pathsConflict('src', 'src/a.js'), true);
  assert.equal(pathsConflict('src/api/**', 'src/api/user.js'), true);
  assert.equal(pathsConflict('src/**', 'src/x.js'), true);
  assert.equal(pathsConflict('*.js', 'src/x.js'), true);
  assert.equal(pathsConflict('src/a.js', 'src/b.js'), false);
  assert.equal(pathsConflict('src/api/**', 'src/ui/**'), false);
});

test('validatePackages：没有文件重叠时并行不报错', () => {
  const { errors } = validatePackages([
    pkg({ id: 'k1', files: ['src/api/**'] }),
    pkg({ id: 'k2', files: ['src/ui/**'] }),
  ]);
  assert.deepEqual(errors, []);
});

test('validatePackages：并行改同一批文件必须报错', () => {
  const { errors } = validatePackages([
    pkg({ id: 'k1', files: ['src/app.js'] }),
    pkg({ id: 'k2', files: ['src/app.js'] }),
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /加 dependsOn/);
});

test('validatePackages：有先后依赖就不算并行冲突', () => {
  const { errors } = validatePackages([
    pkg({ id: 'k1', files: ['src/app.js'] }),
    pkg({ id: 'k2', files: ['src/app.js'], dependsOn: ['k1'] }),
  ]);
  assert.deepEqual(errors, []);
});

test('validatePackages：循环依赖要抓住', () => {
  const { errors } = validatePackages([
    pkg({ id: 'k1', dependsOn: ['k2'] }),
    pkg({ id: 'k2', dependsOn: ['k1'] }),
  ]);
  assert.ok(errors.some((item) => /循环依赖/.test(item)));
});

test('validatePackages：依赖不存在、id 重复、缺标题都报错', () => {
  const { errors } = validatePackages([
    pkg({ id: 'k1', dependsOn: ['k9'] }),
    pkg({ id: 'k1' }),
    pkg({ id: 'k2', title: '' }),
  ]);
  assert.ok(errors.some((item) => /不存在的工单：k9/.test(item)));
  assert.ok(errors.some((item) => /id 重复：k1/.test(item)));
  assert.ok(errors.some((item) => /k2 没有标题/.test(item)));
});

test('validatePackages：缺文件声明或缺 dod 只给警告', () => {
  const { errors, warnings } = validatePackages([pkg({ files: [], dod: [] })]);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 2);
});

test('readyPackages：依赖没合入之前不能开工', () => {
  const list = [
    pkg({ id: 'k1', state: 'doing' }),
    pkg({ id: 'k2', state: 'queued', dependsOn: ['k1'] }),
    pkg({ id: 'k3', state: 'queued' }),
  ];
  assert.deepEqual(readyPackages(list).map((item) => item.id), ['k3']);
  assert.equal(nextPackage(list).id, 'k3');
  list[0].state = 'merged';
  assert.deepEqual(readyPackages(list).map((item) => item.id), ['k2', 'k3']);
});

test('describePackages：空列表与进度描述', () => {
  assert.equal(describePackages([]), '未拆工单');
  const text = describePackages([
    pkg({ id: 'k1', state: 'doing' }),
    pkg({ id: 'k2', state: 'queued' }),
  ]);
  assert.match(text, /共 2/);
  assert.match(text, /doing 1/);
  assert.match(text, /下一个：k2/);
});

test('packageBrief：把「只许改」和完成标准写给执行者', () => {
  const text = packageBrief(pkg({ goal: '首屏提速' }));
  assert.match(text, /只许改：src\/pages\/home\/\*\*/);
  assert.match(text, /首屏 1 秒内打开/);
  assert.match(text, /越界/);
});

test('packageBrief：没声明文件时明确要求先问项目经理', () => {
  const text = packageBrief(pkg({ files: [] }));
  assert.match(text, /先问项目经理/);
});
