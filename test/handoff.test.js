import test from 'node:test';
import assert from 'node:assert/strict';

import { handoffText } from '../handoff.js';

function project(overrides = {}) {
  return {
    id: 'p1',
    name: '锦盏藏华',
    status: 'zhongshu',
    shape: 'crew',
    rounds: 0,
    workspace: { id: 'w1', path: 'D:\\work\\jinzhan' },
    scope: { original: '把首页改快一点', drift: null, approvedPlanId: '' },
    checks: [{ id: 'c1', cmd: 'npm test' }],
    packages: [],
    manual: [],
    questions: [],
    context: { map: 'pages/ 页面，api/ 接口' },
    briefs: [],
    ...overrides,
  };
}

test('handoffText：长方案只给指针，不再整篇塞进提示词', () => {
  const plan = {
    id: 'b1',
    kind: 'plan',
    title: '架构方案',
    content: 'P'.repeat(20000),
  };
  const text = handoffText(project(), plan, 'zhongshu', 'menxia', '请评审', null);
  assert.ok(text.length < 4000, `实际 ${text.length} 字符`);
  assert.match(text, /id=b1/);
  assert.match(text, /court_read_brief/);
  assert.ok(!text.includes('PPPPPPPPPPPPPPPPPPPP'), '不应内联长正文');
});

test('handoffText：短文书照旧内联，省一次工具调用', () => {
  const brief = { id: 'b2', kind: 'brief', title: '小记', content: '只有一句话。' };
  const text = handoffText(project(), brief, 'zhongshu', 'menxia', '看这个', null);
  assert.match(text, /只有一句话。/);
});

test('handoffText：每次移交都带项目索引与编制', () => {
  const text = handoffText(project({ shape: 'squad' }), null, 'zhongshu', 'shangshu', null, null);
  assert.match(text, /轻量组/);
  assert.match(text, /—— 项目索引（指针，不是正文）——/);
  assert.match(text, /D:\\work\\jinzhan/);
  assert.match(text, /c1=npm test/);
});

test('handoffText：派给执行者时带上工单的「只许改」与完成标准', () => {
  const project0 = project({
    packages: [
      {
        id: 'k1',
        title: '改首页',
        files: ['src/pages/home/**'],
        dod: ['首屏 1 秒内打开'],
        state: 'queued',
        dependsOn: [],
      },
    ],
  });
  const text = handoffText(project0, null, 'shangshu', 'executor', '动手', null);
  assert.match(text, /你这一张工单/);
  assert.match(text, /只许改：src\/pages\/home\/\*\*/);
  assert.match(text, /首屏 1 秒内打开/);
});

test('handoffText：没有可开工工单时明确说不要自己挑', () => {
  const project0 = project({
    packages: [{
      id: 'k1', title: '改首页', files: [], dod: [], state: 'merged', dependsOn: [],
    }],
  });
  const text = handoffText(project0, null, 'shangshu', 'executor', '继续', null);
  assert.match(text, /当前没有可开工的工单/);
});

test('handoffText：派给执行者时方案冲突要以方案为准', () => {
  const brief = { id: 'b3', kind: 'brief', title: '工单', content: '改 A' };
  const plan = { id: 'b4', kind: 'plan', title: '方案', content: 'Q'.repeat(9000) };
  const text = handoffText(project(), brief, 'shangshu', 'executor', '动手', plan);
  assert.match(text, /以方案为准/);
  assert.match(text, /id=b4/);
  assert.ok(!text.includes('QQQQQQQQQQQQQQQQQQQQ'));
});
