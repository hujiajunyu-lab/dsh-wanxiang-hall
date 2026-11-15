window.__ModuleLoader__.load({
  id: 'dsh-wanxiang-hall',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'wanxiang-hall';
    /** apply(ctx) 里保存的客户端上下文，供「叫醒秘书」前解档使用。 */
    let clientCtx = null;

    /** 编制显示名：新项目带 shape，老项目只有 mode，两种都要能显示。 */
    const SHAPE_SHORT = { squad: '轻量', crew: '项目', line: '流水' };
    const SHAPE_FULL = { squad: '轻量组', crew: '项目组', line: '流水线' };
    function shapeKeyOf(project) {
      if (project && SHAPE_SHORT[project.shape]) return project.shape;
      return project && project.mode === 'lite' ? 'squad' : 'crew';
    }
    function shapeShort(project) {
      return SHAPE_SHORT[shapeKeyOf(project)];
    }
    // 承接（court_fork_project）：这一轮接的是哪个项目，让人一眼看出「不用重新摸底」
    function lineageText(project) {
      const lineage = project && project.lineage;
      if (!lineage || !lineage.parentId) return '';
      return '承接 ' + (lineage.name || lineage.parentId);
    }
    // 用户操作单：只有人能做的那几件事，卡住交付的会点出来
    function manualHint(project) {
      const list = (project && project.manual) || [];
      if (list.length === 0) return '无需你动手';
      const pending = list.filter((item) => item.status !== 'done');
      if (pending.length === 0) return '全部已完成';
      const blocking = pending.filter((item) => item.blocking).length;
      return pending.length + ' 项待做' + (blocking ? '（' + blocking + ' 项卡交付）' : '');
    }
    function LineageChip({ project }) {
      const text = lineageText(project);
      if (!text) return null;
      return h('span', {
        className: 'dsc-meta',
        title: '同一仓库的后续：上下文、文件归属、验收命令与会话已从上个项目接过来',
      }, text);
    }
    function shapeFull(project) {
      return SHAPE_FULL[shapeKeyOf(project)];
    }

    /** 文书类型的中文名与预算，跟 context.js 的 BUDGET 保持一致。 */
    const KIND_LABEL = {
      brief: '记录', plan: '方案', architecture: '架构', contract: '契约', quote: '报价',
      package: '工单', report: '交付说明', acceptance: '验收结论', change: '变更单',
      closing: '结项', review: '复审', verdict: '裁决',
    };
    const KIND_BUDGET = {
      contract: 6000, quote: 1500, package: 2000, change: 2000, architecture: 8000,
      plan: 12000, acceptance: 3000, closing: 3000, brief: 6000, report: 6000,
    };
    function kindLabel(kind) {
      return KIND_LABEL[kind] || '记录';
    }
    function kindOverBudget(brief) {
      const budget = KIND_BUDGET[brief && brief.kind];
      if (!budget || !brief) return false;
      const chars = brief.chars || (brief.content || '').length;
      return chars > budget;
    }

    const PACKAGE_STATE_LABEL = {
      queued: '待开工', doing: '进行中', ready: '待验收', merged: '已合入', blocked: '阻塞',
    };
    const PACKAGE_STATE_TONE = {
      queued: 'neutral', doing: 'info', ready: 'warn', merged: 'ok', blocked: 'danger',
    };
    function packageStateLabel(state) {
      return PACKAGE_STATE_LABEL[state] || '待开工';
    }
    function packageTone(state) {
      return PACKAGE_STATE_TONE[state] || 'neutral';
    }
    function packageSummary(project) {
      const list = (project && project.packages) || [];
      const done = list.filter((item) => item.state === 'merged').length;
      const doing = list.filter((item) => item.state === 'doing').length;
      const blocked = list.filter((item) => item.state === 'blocked').length;
      return done + '/' + list.length + (doing ? ' · ' + doing + ' 进行中' : '')
        + (blocked ? ' · ' + blocked + ' 阻塞' : '');
    }
    function contextFilled(project) {
      const ctx = (project && project.context) || {};
      return Boolean((ctx.map || '').trim() || (ctx.stack || '').trim()
        || (ctx.conventions || '').trim() || (ctx.gotchas || '').trim()
        || (ctx.topPaths || []).length);
    }
    function contextRows(project) {
      const ctx = (project && project.context) || {};
      const rows = [
        { key: 'map', label: '结构', value: ctx.map },
        { key: 'stack', label: '技术栈', value: ctx.stack },
        { key: 'conventions', label: '约定', value: ctx.conventions },
        { key: 'gotchas', label: '坑', value: ctx.gotchas },
        { key: 'topPaths', label: '常改文件', value: (ctx.topPaths || []).join('\n') },
      ];
      return rows.filter((row) => (row.value || '').trim());
    }

    const zh = {
      'app.title': '万象工阁',
      'app.subtitle': '幻盏 · 万象幻容：接单、排期、施工、验收、交付，一个人开一家公司。',
      'app.credit': '本插件由幻盏衍露制作！欢迎多多反馈！',
      'tab.secretary': '接单台',
      'tab.chancellery': '工位',
      'tab.hall': '项目看板',
      'tab.scriptorium': '智库',
      'secretary.entry': '接单台',
      'sub.secretary': '统筹所有项目，汇报进度，接你的第一句话。',
      'sub.chancellery': '架构定方案 · 评审把关 · 项目管理派工 · 工程师施工。',
      'sub.hall': '项目库：阶段、进度、卡点，一眼看清。',
      'sub.scriptorium': '企业智库：决策、约定、坑、做法、客户偏好，跨项目复用。',
    };

    const en = {
      'app.title': 'Wanxiang Gongge',
      'app.subtitle': 'Huanzhan · Wanxiang Huanrong: intake, plan, build, accept, deliver.',
      'app.credit': 'Made by Huanzhan Yanlu — feedback always welcome.',
      'tab.secretary': 'Intake',
      'tab.chancellery': 'Workstations',
      'tab.hall': 'Project board',
      'tab.scriptorium': 'Knowledge',
      'secretary.entry': 'Intake desk',
      'sub.secretary': 'Coordinates every project and reports to you.',
      'sub.chancellery': 'Architect plans, reviewer gates, PM assigns, engineers build.',
      'sub.hall': 'Project library: stage, progress, blockers.',
      'sub.scriptorium': 'Your knowledge vault.',
    };

    // ---------------------------------------------------------------------
    // 常量
    // ---------------------------------------------------------------------

    const STATUS = {
      draft: { label: '待立项', tone: 'neutral' },
      zhongshu: { label: '架构中', tone: 'info' },
      menxia: { label: '评审中', tone: 'warn' },
      shangshu: { label: '排期中', tone: 'info' },
      executing: { label: '施工中', tone: 'active' },
      review: { label: '待验收', tone: 'warn' },
      done: { label: '已交付', tone: 'ok' },
      paused: { label: '已暂停', tone: 'muted' },
      archived: { label: '已归档', tone: 'muted' },
      blocked: { label: '待你决定', tone: 'danger' },
    };

    const DEPTS = [
      { key: 'zhongshu', province: '方案', role: '架构师', order: '①' },
      { key: 'menxia', province: '把关', role: '评审', order: '②' },
      { key: 'shangshu', province: '派工', role: '项目经理', order: '③' },
      { key: 'executor', province: '施工', role: '工程师', order: '④' },
    ];

    const NEXT_STEP = {
      draft: { label: '交给架构', status: 'zhongshu' },
      zhongshu: { label: '提交评审审核', status: 'menxia' },
      menxia: { label: '审核通过，移交项目管理', status: 'shangshu' },
      shangshu: { label: '开始执行', status: 'executing' },
      executing: { label: '执行完成，转验收', status: 'review' },
      review: { label: '验收通过，结项', status: 'done' },
      blocked: { label: '解除阻塞，回到架构', status: 'zhongshu' },
    };

    const TABS = [
      { id: 'secretary', label: 'tab.secretary' },
      { id: 'chancellery', label: 'tab.chancellery' },
      { id: 'hall', label: 'tab.hall' },
      { id: 'scriptorium', label: 'tab.scriptorium' },
    ];

    const CSS = [
      '.dsc-root{height:100%;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}',
      '.dsc-wrap{max-width:920px;margin:0 auto;padding:34px 32px 64px;box-sizing:border-box;}',
      '.dsc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}',
      '.dsc-eyebrow{font-size:11px;font-weight:600;letter-spacing:.16em;color:var(--dsw-alias-label-secondary);}',
      '.dsc-credit{margin-top:7px;font-size:11.5px;letter-spacing:.03em;color:var(--dsw-alias-label-secondary);opacity:.66;}',
      '.dsc-chip--on{border-color:transparent;background:var(--dsw-alias-interactive-primary);color:#fff;}',
      '.dsc-kbtags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;}',
      '.dsc-kbtag{font-size:10.5px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,0.14);color:var(--dsw-alias-label-secondary);}',
      '.dsc-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '.dsc-card--click{cursor:pointer;}',
      '.dsc-kbroll{max-height:340px;overflow-y:auto;overscroll-behavior:contain;padding-right:6px;scrollbar-width:thin;}',
      '.dsc-kbroll--tall{max-height:min(78vh,780px);}',
      '.dsc-kbroll::-webkit-scrollbar{width:7px;}',
      '.dsc-kbroll::-webkit-scrollbar-thumb{background:rgba(127,127,127,0.32);border-radius:99px;}',
      '.dsc-kbroll::-webkit-scrollbar-track{background:transparent;}',
      '.dsc-title{font-size:25px;line-height:1.2;font-weight:600;margin:8px 0 6px;}',
      '.dsc-sub{margin:0;font-size:13.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);}',
      '.dsc-headside{display:flex;align-items:center;gap:8px;flex:none;}',
      '.dsc-tabs{display:flex;gap:4px;margin:20px 0 2px;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);width:fit-content;max-width:100%;overflow-x:auto;}',
      '.dsc-tab{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:6px 14px;border-radius:8px;cursor:pointer;white-space:nowrap;font-family:inherit;}',
      '.dsc-tab:hover{color:var(--dsw-alias-label-primary);}',
      '.dsc-tab[aria-selected="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.12);font-weight:600;}',
      '.dsc-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}',
      '.dsc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12.5px;cursor:pointer;white-space:nowrap;font-family:inherit;}',
      '.dsc-btn:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.dsc-btn:disabled{opacity:.45;cursor:not-allowed;}',
      '.dsc-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '.dsc-btn--primary{background:var(--dsw-alias-button-contrast-fill);border-color:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);}',
      '.dsc-btn--primary:hover{background:var(--dsw-alias-button-contrast-fill);opacity:.9;color:var(--dsw-alias-label-primary-inverted);}',
      '.dsc-btn--danger{color:#dc2626;border-color:rgba(220,38,38,.35);}',
      '.dsc-btn--sm{height:26px;padding:0 9px;font-size:12px;}',
      '.dsc-banner{display:flex;align-items:center;gap:10px;margin-top:14px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);font-size:12.5px;}',
      '.dsc-banner-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsc-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:20px 0 4px;}',
      '.dsc-stat{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;}',
      '.dsc-stat-value{font-size:20px;font-weight:600;line-height:1.2;}',
      '.dsc-stat-label{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-matrix-row{display:grid;grid-template-columns:minmax(0,1fr) 164px;gap:14px;align-items:stretch;margin:20px 0 26px;}',
      '.dsc-matrix{position:relative;min-width:0;min-height:272px;display:grid;grid-template-rows:minmax(0,1fr);gap:4px;}',
      '.dsc-matrix-body{display:grid;grid-template-columns:14px minmax(0,1fr);gap:7px;min-height:0;}',
      '.dsc-axis-y{display:flex;flex-direction:column;align-items:center;gap:3px;padding:2px 0;min-height:0;}',
      '.dsc-axis-tip{font-size:10px;line-height:1.1;color:var(--dsw-alias-label-secondary);letter-spacing:.06em;white-space:nowrap;}',
      '.dsc-axis-line{flex:1 1 auto;width:1px;background:var(--dsw-alias-border-l2);position:relative;}',
      '.dsc-axis-line::before{content:"▴";position:absolute;top:-8px;left:-4px;font-size:9px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-axis-x{position:absolute;left:21px;right:0;bottom:-17px;display:flex;align-items:center;gap:6px;}',
      '.dsc-axis-line-h{flex:1 1 auto;height:1px;background:var(--dsw-alias-border-l2);position:relative;}',
      '.dsc-axis-line-h::after{content:"▸";position:absolute;right:-7px;top:-7px;font-size:9px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-matrix-grid{min-width:0;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:minmax(0,1fr) minmax(0,1fr);gap:1px;background:var(--dsw-alias-border-l1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;}',
      '.dsc-quad{min-width:0;min-height:0;overflow:hidden;padding:8px 10px 9px;display:flex;flex-direction:column;gap:4px;cursor:pointer;transition:filter .15s ease;}',
      '.dsc-quad:hover{filter:brightness(1.14);}',
      '.dsc-quad--open{filter:brightness(1.16);}',
      '.dsc-quad-head{display:flex;align-items:center;gap:5px;min-width:0;}',
      '.dsc-quad-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;}',
      '.dsc-quad-label{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.dsc-quad-count{margin-left:auto;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;opacity:.72;}',
      '.dsc-quad-empty{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.55;}',
      '.dsc-quad-list{display:flex;flex-direction:column;gap:2px;min-width:0;min-height:0;overflow:hidden;}',
      '.dsc-quad--open .dsc-quad-list{overflow-y:auto;scrollbar-width:thin;}',
      '.dsc-quad-item{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:0;}',
      '.dsc-quad-item-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.dsc-quad-more{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.85;margin-top:1px;}',
      '.dsc-stat-col{min-height:0;display:grid;grid-auto-rows:minmax(0,1fr);gap:8px;}',
      '.dsc-stat-col .dsc-stat{min-height:0;padding:8px 12px;border-radius:11px;display:flex;flex-direction:column;justify-content:center;}',
      '.dsc-stat-col .dsc-stat-value{font-size:18px;}',
      '.dsc-stat-col .dsc-stat-label{font-size:11.5px;}',
      '.dsc-quadchip{display:inline-flex;align-items:center;padding:0 6px;height:17px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);font-size:10.5px;line-height:1;white-space:nowrap;}',
      '.dsc-section{margin-top:24px;}',
      '.dsc-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:11px;}',
      '.dsc-section-title{font-size:14.5px;font-weight:600;}',
      '.dsc-section-hint{font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-list{display:flex;flex-direction:column;gap:9px;}',
      '.dsc-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;}',
      '.dsc-card--click{cursor:pointer;}',
      '.dsc-card--click:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.dsc-row{display:flex;align-items:center;gap:9px;justify-content:space-between;}',
      '.dsc-rowmain{display:flex;align-items:center;gap:9px;min-width:0;}',
      '.dsc-name{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsc-desc{margin-top:6px;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);}',
      '.dsc-meta{margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);font-size:11px;font-weight:500;white-space:nowrap;}',
      '.dsc-tone-neutral{border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);}',
      '.dsc-tone-muted{opacity:.65;}',
      '.dsc-tone-info{border-color:rgba(37,99,235,.4);background:rgba(37,99,235,.12);color:#3b82f6;}',
      '.dsc-tone-warn{border-color:rgba(217,119,6,.4);background:rgba(217,119,6,.12);color:#d97706;}',
      '.dsc-tone-ok{border-color:rgba(22,163,74,.4);background:rgba(22,163,74,.12);color:#16a34a;}',
      '.dsc-tone-danger{border-color:rgba(220,38,38,.4);background:rgba(220,38,38,.12);color:#dc2626;}',
      '.dsc-tone-active{border-color:var(--dsw-alias-button-contrast-fill);background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);}',
      '.dsc-progress{display:flex;align-items:center;gap:8px;flex:none;}',
      '.dsc-bar{width:96px;height:5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}',
      '.dsc-barfill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary-new-color,var(--dsw-alias-brand-primary));transition:width .2s ease;}',
      '.dsc-pct{font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;width:34px;text-align:right;}',
      '.dsc-pipe{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:4px;}',
      '.dsc-node{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 13px;display:flex;flex-direction:column;gap:7px;min-height:104px;}',
      '.dsc-node--active{border-color:var(--dsw-alias-brand-primary);}',
      '.dsc-node-order{font-size:11px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-node-role{font-size:13px;font-weight:600;}',
      '.dsc-node-province{font-size:11px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-node-foot{margin-top:auto;display:flex;align-items:center;gap:6px;}',
      '.dsc-actions{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;}',
      '.dsc-field{display:flex;flex-direction:column;gap:6px;margin-bottom:10px;}',
      '.dsc-label{font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-input,.dsc-textarea{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;}',
      '.dsc-input:focus,.dsc-textarea:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px;border-color:transparent;}',
      '.dsc-textarea{min-height:64px;resize:vertical;line-height:1.5;}',
      '.dsc-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:22px 18px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.6;}',
      '.dsc-error{margin-top:16px;border:1px solid rgba(220,38,38,.35);background:rgba(220,38,38,.1);color:#dc2626;border-radius:10px;padding:10px 12px;font-size:12.5px;}',
      '.dsc-flash{margin-top:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:9px 12px;font-size:12.5px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-chips{display:flex;flex-wrap:wrap;gap:7px;}',
      '.dsc-chip{padding:4px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:inherit;}',
      '.dsc-chip[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);}',
      '.dsc-check{display:flex;align-items:flex-start;gap:10px;width:100%;padding:9px 2px;border:none;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;text-align:left;cursor:pointer;border-top:1px solid var(--dsw-alias-border-l1);font-family:inherit;}',
      '.dsc-check:first-child{border-top:none;}',
      '.dsc-box{flex:none;margin-top:1px;width:16px;height:16px;border-radius:4px;border:1.5px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;justify-content:center;}',
      '.dsc-check[aria-checked="true"] .dsc-box{background:var(--dsw-alias-button-contrast-fill);border-color:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);}',
      '.dsc-check[aria-checked="true"] .dsc-checktext{color:var(--dsw-alias-label-secondary);text-decoration:line-through;}',
      '.dsc-weight{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:auto;padding-left:10px;flex:none;}',
      '.dsc-kv{display:flex;gap:8px;font-size:12.5px;line-height:1.7;}',
      '.dsc-kv-key{color:var(--dsw-alias-label-secondary);flex:none;width:72px;}',
      '.dsc-kv-val{word-break:break-all;}',
      '.dsc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;}',
      '.dsc-note{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);}',
      '.dsc-form{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:18px 18px 0;margin-top:14px;}',
      '.dsc-form-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;}',
      '.dsc-form-title{font-size:15px;font-weight:600;}',
      '.dsc-form-desc{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin-top:3px;}',
      '.dsc-form-body{display:flex;flex-direction:column;gap:14px;}',
      '.dsc-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px;}',
      '@media (max-width:720px){.dsc-grid{grid-template-columns:1fr;}}',
      '.dsc-opt{display:flex;flex-direction:column;gap:7px;min-width:0;}',
      '.dsc-seg{display:inline-flex;flex-wrap:wrap;gap:3px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);width:fit-content;max-width:100%;}',
      '.dsc-seg-btn{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:5px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;font-family:inherit;}',
      '.dsc-seg-btn:hover{color:var(--dsw-alias-label-primary);}',
      '.dsc-seg-btn[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12);}',
      '.dsc-seg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}',
      '.dsc-formfoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin:16px -18px 0;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1);border-radius:0 0 14px 14px;background:var(--dsw-alias-bg-layer-1);}',
      '.dsc-formfoot .dsc-note{margin-right:auto;}',
      '.dsc-done{display:flex;flex-direction:column;gap:10px;padding:6px 0 18px;}',
      '.dsc-done-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;}',
      '.dsc-done-icon{width:20px;height:20px;border-radius:999px;background:rgba(22,163,74,.14);color:#16a34a;display:inline-flex;align-items:center;justify-content:center;flex:none;}',
      '.dsc-flash--ok{border-color:rgba(22,163,74,.35);background:rgba(22,163,74,.1);color:#16a34a;}',
      '.dsc-flash--warn{border-color:rgba(217,119,6,.35);background:rgba(217,119,6,.1);color:#d97706;}',
      '.dsc-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;}',
      '.dsc-sep{width:1px;align-self:stretch;min-height:18px;background:var(--dsw-alias-border-l1);margin:0 2px;}',
      '.dsc-draft-hint{color:#d97706;}',
      /* ── 接单台快捷入口 ── */
      '.dsc-secbtn{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12.5px;cursor:pointer;touch-action:pan-y;user-select:none;-webkit-user-select:none;}',
      '.dsc-secbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}',
      '.dsc-secbtn:disabled{opacity:.6;cursor:default;}',
      '.dsc-secbtn--drag{border-color:rgba(220,120,40,.65);background:rgba(220,120,40,.16);}',
      '.dsc-secbtn--armed{border-color:rgba(220,120,40,.45);}',
      '.dsc-secbtn .dsc-secbtn-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary);}',
      '.dsc-footbtn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12.5px;cursor:pointer;touch-action:pan-y;user-select:none;-webkit-user-select:none;}',
      '.dsc-footbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
      '.dsc-footbtn--drag{background:rgba(220,120,40,.18);color:var(--dsw-alias-label-primary);}',
      /* ── 立项拖拽 ── */
      '.dsc-drop{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:10px 12px;margin-top:10px;background:var(--dsw-alias-bg-layer-1);}',
      '.dsc-drop--hot{border-color:var(--dsw-alias-state-business-primary);background:rgba(77,107,254,.10);}',
      '.dsc-filechip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 8px;margin:4px 6px 0 0;border-radius:8px;background:var(--dsw-alias-bg-module-platform);font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.dsc-filechip b{font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;}',
      '.dsc-filechip button{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;}',
      /* ── 多选弹层（参考微信「多选」） ── */
      '.dsc-modal{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:24px;}',
      '.dsc-modal-card{width:min(880px,100%);max-height:min(78vh,720px);display:flex;flex-direction:column;border-radius:14px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 18px 50px rgba(0,0,0,.35);overflow:hidden;}',
      '.dsc-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
      '.dsc-modal-title{font-size:14.5px;font-weight:600;color:var(--dsw-alias-label-primary);}',
      '.dsc-modal-body{display:grid;grid-template-columns:236px 1fr;min-height:0;flex:1;}',
      '.dsc-modal-side{border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:8px;}',
      '.dsc-sideitem{display:block;width:100%;text-align:left;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12.5px;padding:8px 10px;border-radius:8px;cursor:pointer;}',
      '.dsc-sideitem:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dsc-sideitem[aria-selected="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;}',
      '.dsc-modal-main{overflow:auto;padding:8px 12px;}',
      '.dsc-msgrow{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;border:none;background:transparent;font-family:inherit;padding:8px;border-radius:10px;cursor:pointer;}',
      '.dsc-msgrow:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dsc-msgrow[aria-selected="true"]{background:rgba(77,107,254,.12);}',
      '.dsc-msgcheck{flex:none;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;justify-content:center;margin-top:2px;color:#fff;}',
      '.dsc-msgrow[aria-selected="true"] .dsc-msgcheck{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);}',
      '.dsc-msgmeta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:2px;}',
      '.dsc-msgtext{font-size:12.5px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;}',
      '.dsc-modal-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);}',
      '.dsc-refitem{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);}',
      '.dsc-refitem:last-child{border-bottom:none;}',
      '.dsc-reftext{font-size:12.5px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;}',
      /* ── 一键备份 ── */
      '.dsc-health{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
      '.dsc-health-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;}',
      '.dsc-backupchip{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);}',
      '.dsc-backupchip button{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:2px 2px;border-radius:4px;}',
      '.dsc-backupchip button:hover:not(:disabled){background:transparent;color:var(--dsw-alias-label-primary);}',
      '.dsc-backupchip button:disabled{opacity:.55;cursor:default;}',
      '.dsc-backupchip>span{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      /* 小提示条：右下角浮出，不占输入框那一行 */
      '.dsc-toast{position:fixed;right:24px;bottom:96px;z-index:70;max-width:320px;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.28);pointer-events:none;}',
      '.dsc-toast--bad{border-color:rgba(220,38,38,.5);}',
    ].join('');

    // ---------------------------------------------------------------------
    // HTTP
    // ---------------------------------------------------------------------

    async function api(path, init) {
      const response = await fetch(path, {
        cache: 'no-store',
        ...init,
        headers: { 'content-type': 'application/json', ...(init && init.headers) },
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (!response.ok) {
        throw new Error((data && data.error && data.error.message) || ('HTTP ' + response.status));
      }
      return data;
    }

    const courtApi = {      state: () => api('/court/state'),
      create: (payload) => api('/court/projects', { method: 'POST', body: JSON.stringify(payload) }),
      patch: (id, patch) => api('/court/projects', { method: 'PATCH', body: JSON.stringify({ id, patch }) }),
      toggle: (projectId, milestoneId, done) => api('/court/milestones', {
        method: 'POST',
        body: JSON.stringify({ projectId, milestoneId, done }),
      }),
      remove: (id) => api('/court/projects/delete', { method: 'POST', body: JSON.stringify({ id }) }),
      clearJump: () => api('/court/jump', { method: 'POST', body: JSON.stringify({}) }),
      say: (text) => api('/court/secretary', { method: 'POST', body: JSON.stringify({ text }) }),
      handoff: (projectId, to, note) => api('/court/handoff', {
        method: 'POST',
        body: JSON.stringify({ projectId, to, note }),
      }),
      sessions: () => api('/court/sessions'),
      archiveSessions: (sessionIds) => api('/court/sessions/archive', {
        method: 'POST',
        body: JSON.stringify({ sessionIds }),
      }),
      vaultIntake: (projectId) => api('/court/vault/intake', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      }),
      vaultStatus: (projectId) => api('/court/vault/status', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      }),
      answer: (projectId, questionId, answer) => api('/court/questions/answer', {
        method: 'POST',
        body: JSON.stringify({ projectId, questionId, answer }),
      }),
      confirmScope: (projectId, note) => api('/court/scope/confirm', {
        method: 'POST',
        body: JSON.stringify({ projectId, note }),
      }),
      setVaultPath: (vaultPath) => api('/court/settings', {
        method: 'POST',
        body: JSON.stringify({ vaultPath }),
      }),
      messages: (sessionId) => api('/court/session-messages', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      }),
      addReference: (payload) => api('/court/projects/references', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      removeReference: (projectId, referenceId) => api('/court/projects/references/remove', {
        method: 'POST',
        body: JSON.stringify({ projectId, referenceId }),
      }),
      deleteAttachment: (projectId, attachmentId) => api('/court/attachments/delete', {
        method: 'POST',
        body: JSON.stringify({ projectId, attachmentId }),
      }),
      ensureSecretary: () => api('/court/secretary/ensure', { method: 'POST', body: JSON.stringify({}) }),
      resetSecretary: () => api('/court/secretary/reset', { method: 'POST', body: JSON.stringify({}) }),
      backup: (force) => api('/court/backup', { method: 'POST', body: JSON.stringify(force ? { force: true } : {}) }),
      setBackupMode: (on) => api('/court/backup/mode', { method: 'POST', body: JSON.stringify({ on }) }),
      setGrant: (on) => api('/court/grant', { method: 'POST', body: JSON.stringify({ on }) }),
      kb: (params) => {
        const search = new URLSearchParams();
        const input = params || {};
        if (input.q) search.set('q', input.q);
        if (input.kind) search.set('kind', input.kind);
        if (input.tag) search.set('tag', input.tag);
        if (input.limit) search.set('limit', String(input.limit));
        const tail = search.toString();
        return api('/court/kb' + (tail ? '?' + tail : ''));
      },
      kbSave: (payload) => api('/court/kb/save', { method: 'POST', body: JSON.stringify(payload) }),
      kbUpdate: (payload) => api('/court/kb/update', { method: 'POST', body: JSON.stringify(payload) }),
      kbDigest: (projectId) => api('/court/kb/digest', { method: 'POST', body: JSON.stringify({ projectId }) }),
    };

    /** 附件走原样二进制，不能用上面的 JSON 通道。 */
    async function uploadAttachmentFile(projectId, file) {
      const response = await fetch(
        '/court/attachments?projectId=' + encodeURIComponent(projectId)
        + '&name=' + encodeURIComponent(file.name || 'file'),
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        },
      );
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (!response.ok) {
        throw new Error((data && data.error && data.error.message) || ('HTTP ' + response.status));
      }
      return data;
    }

    /**
     * 给秘书投递前，先把可能被归档的秘书会话解档。
     *
     * DSH 的 ArchivedSessionGate 会把「已归档会话」的新消息直接以 blocked 结束：
     * 表面上看 HTTP 返回 accepted，实际 turn 根本没跑。叫醒秘书前必须解档。
     */
    async function unarchiveCurrentSecretary(sessionId = null) {
      if (!clientCtx) return false;
      if (!sessionId) {
        try {
          const state = await courtApi.state();
          sessionId = state && state.settings ? state.settings.secretarySessionId : null;
        } catch {
          return false;
        }
      }
      if (!sessionId) return false;
      try {
        const workspace = typeof clientCtx.get === 'function' ? clientCtx.get('uiWorkspace') : undefined;
        if (workspace && typeof workspace.unarchiveSession === 'function') {
          await workspace.unarchiveSession(sessionId);
          return true;
        }
      } catch {
        // 已经解档过、或该会话不在归档列表里：继续投递即可。
      }
      return false;
    }

    /** 客户端统一的「叫醒秘书」入口：先解档，再投递。 */
    async function tellSecretary(text) {
      await unarchiveCurrentSecretary();
      return courtApi.say(text);
    }

    /** 用户手填的路径经常带着成对引号；去掉首尾引号，避免把引号写进工作区。 */
    function cleanPath(value) {
      return String(value || '')
        .trim()
        .replace(/^["'“”‘’]+/, '')
        .replace(/["'“”‘’]+$/, '')
        .trim();
    }

    /** 人类可读的字节数。 */
    function formatBytes(value) {
      const bytes = Number(value) || 0;
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    /**
     * 手动立项后给秘书的交接词。
     * 手工立项不经过秘书会话，这里必须把项目 id 带上，避免秘书再 court_create_project 建一个重复项目。
     */
    function manualSecretaryBrief(project, workspacePath, attachments = []) {
      const workspace = cleanPath(workspacePath);
      const files = (attachments || []).filter((item) => item && item.path);
      return [
        '【万象工阁 · 手动立项】',
        '用户已在面板里直接立项，项目已经存在；不要重复 court_create_project。',
        `项目：${project.name}（${project.id}）`,
        `编制：${shapeFull(project)}（${shapeKeyOf(project)}）`,
        project.description ? `需求：${project.description}` : '需求：用户暂未填写，请先问清目标与验收标准。',
        workspace ? `工作区：${workspace}` : '工作区：未指定，请先和用户确认一个现成目录。',
        files.length > 0
          ? '\n项目附件（用户立项时拖进来的，已经在本地，直接读，不要要求用户重发）：\n'
            + files.map((item) => `- ${item.path}（${item.name || ''}，${formatBytes(item.bytes)}）`).join('\n')
          : '',
        '',
        '请接手：先用 court_get_project view=work 读项目，确认范围与工作区，然后 court_handoff 到架构',
        '（轻量模式可先定工作区再交架构师）。有不确定的产品决策再 court_ask_user(blocking:true)。',
      ].filter((line) => line !== undefined && line !== null).join('\n');
    }

    /**
     * 把万象工阁的五个角色从「新建会话」的 Agent 模式菜单里藏起来。
     *
     * 这五个 preset 是给面板内部建会话用的，不应该出现在通用模式选择器里。
     * 目前宿主注册表没有 hidden 字段，所以只能在渲染层按条目标识过滤；只作用于
     * role=menu 的菜单，不影响「设置 → Agent 模式」里的管理卡片。
     */
    function installPresetMenuFilter() {
      if (typeof document === 'undefined') return () => {};
      if (typeof MutationObserver === 'undefined') return () => {};
      const roleDescriptions = [
        '接单台：立项、催办、汇报。用户的常驻入口。',
        '架构：问清需求、草拟方案与提示词，递交评审。',
        '评审：独立审核架构的方案，可通过或驳回。',
        '项目管理：定工作区、派活给工程师、盯进度。',
        '项目管理下的工程师：在项目工作区里把活干完。',
      ];
      const roleNames = ['秘书', '架构师', '评审', '项目经理', '工程师'];
      let frame = 0;

      const hide = (item) => {
        if (!item || item.dataset.courtPresetHidden === 'true') return false;
        const text = String(item.textContent || '').replace(/\s+/g, ' ').trim();
        const matched = roleDescriptions.some((desc) => text.includes(desc))
          || roleNames.some((name) => text === name || text.startsWith(name + ' '))
            && roleDescriptions.some((desc) => text.includes(desc.slice(0, 6)));
        if (!matched) return false;
        item.dataset.courtPresetHidden = 'true';
        item.style.display = 'none';
        item.setAttribute('aria-hidden', 'true');
        item.tabIndex = -1;
        item.disabled = true;
        return true;
      };

      const scan = () => {
        frame = 0;
        for (const item of document.querySelectorAll('[role="menu"] button[role="menuitem"]')) hide(item);
      };

      const schedule = () => {
        if (frame) return;
        frame = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(scan)
          : setTimeout(scan, 0);
      };

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.('[role="menu"]') || node.querySelector?.('[role="menu"]')) {
              schedule();
              return;
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      schedule();
      return () => {
        observer.disconnect();
        if (frame) {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
          else clearTimeout(frame);
        }
      };
    }

    // ---------------------------------------------------------------------
    // Hooks
    // ---------------------------------------------------------------------

    function useCourt() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const lastSeq = React.useRef(null);

      const refresh = React.useCallback(async () => {
        try {
          const next = await courtApi.state();
          // 轮询只在 seq 变化时更新，避免每 4 秒整页重渲染导致列表和输入框“抖”。
          if (next && next.seq !== lastSeq.current) {
            lastSeq.current = next.seq;
            setData(next);
          }
          setError(null);
          return next;
        } catch (failure) {
          setError(failure && failure.message ? failure.message : String(failure));
          return null;
        }
      }, []);

      React.useEffect(() => {
        let alive = true;
        const run = () => {
          if (!alive) return;
          if (typeof document !== 'undefined' && document.hidden) return;
          void refresh();
        };
        run();
        const timer = setInterval(run, 4000);
        const onVisible = () => {
          if (typeof document !== 'undefined' && !document.hidden) run();
        };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
        return () => {
          alive = false;
          clearInterval(timer);
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
        };
      }, [refresh]);

      return { data, error, refresh };
    }

    // ---------------------------------------------------------------------
    // 原子组件
    // ---------------------------------------------------------------------

    function Icon({ name, size = 16 }) {
      const props = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block' },
      };
      if (name === 'company') {
        return h('svg', props,
          h('path', { d: 'M4 20V9.5L12 4l8 5.5V20', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' }),
          h('path', { d: 'M9 20v-5h6v5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' }),
          h('path', { d: 'M3 20h18', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }));
      }
      if (name === 'seal') {
        return h('svg', props,
          h('rect', { x: 4, y: 5.5, width: 16, height: 13, rx: 2.6, stroke: 'currentColor', strokeWidth: 1.7 }),
          h('path', { d: 'M8.2 10.2h7.6M8.2 13.6h4.8', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }));
      }
      if (name === 'check') {
        return h('svg', props,
          h('path', {
            d: 'M5 12.5 10 17.5 19 7.5',
            stroke: 'currentColor',
            strokeWidth: 2.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }));
      }
      return h('svg', props);
    }

    function Badge({ status }) {
      const meta = STATUS[status] || STATUS.draft;
      return h('span', { className: 'dsc-badge dsc-tone-' + meta.tone }, meta.label);
    }

    function Stat({ value, label }) {
      return h('div', { className: 'dsc-stat' },
        h('div', { className: 'dsc-stat-value' }, String(value)),
        h('div', { className: 'dsc-stat-label' }, label));
    }

    // ---------------------------------------------------------------------
    // 优先级四象限：重要 / 紧急，立项时选；主页按象限摆位置
    // ---------------------------------------------------------------------

    const QUADRANTS = [
      { key: 'important-urgent', label: '重要且紧急', hint: '现在就做', color: '#e5484d', soft: 'rgba(229,72,77,0.11)' },
      { key: 'important-not-urgent', label: '重要不紧急', hint: '排期做', color: '#5b8def', soft: 'rgba(91,141,239,0.11)' },
      { key: 'urgent-not-important', label: '紧急不重要', hint: '尽快清掉', color: '#f5a524', soft: 'rgba(245,165,36,0.11)' },
      { key: 'neither', label: '不重要不紧急', hint: '有空再说', color: '#6b7280', soft: 'rgba(107,114,128,0.09)' },
    ];

    // 折叠时每个象限最多露 4 个项目，第 5 个位置换成「…+N」。
    const QUAD_VISIBLE = 4;

    const QUADRANT_BY_KEY = {};
    for (const quadrant of QUADRANTS) QUADRANT_BY_KEY[quadrant.key] = quadrant;

    function quadrantOf(project) {
      const priority = (project && project.priority) || {};
      const important = !!priority.important;
      const urgent = !!priority.urgent;
      if (important && urgent) return 'important-urgent';
      if (important) return 'important-not-urgent';
      if (urgent) return 'urgent-not-important';
      return 'neither';
    }

    function QuadrantMatrix({ projects }) {
      const [pinned, setPinned] = React.useState(null);
      const [hovered, setHovered] = React.useState(null);
      const buckets = {};
      for (const quadrant of QUADRANTS) buckets[quadrant.key] = [];
      for (const project of projects) buckets[quadrantOf(project)].push(project);

      const cell = (key) => {
        const quadrant = QUADRANT_BY_KEY[key];
        const rows = buckets[key];
        const open = pinned === key || hovered === key;
        const shown = open ? rows : rows.slice(0, QUAD_VISIBLE);
        const hidden = rows.length - shown.length;
        return h('div', {
          key,
          className: 'dsc-quad' + (open ? ' dsc-quad--open' : ''),
          style: { background: quadrant.soft },
          title: quadrant.label + ' · ' + quadrant.hint,
          onMouseEnter: () => setHovered(key),
          onMouseLeave: () => setHovered((current) => (current === key ? null : current)),
          onClick: () => setPinned((current) => (current === key ? null : key)),
        },
          h('div', { className: 'dsc-quad-head' },
            h('span', { className: 'dsc-quad-dot', style: { background: quadrant.color } }),
            h('span', { className: 'dsc-quad-label' }, quadrant.label),
            h('span', { className: 'dsc-quad-count' }, String(rows.length))),
          rows.length === 0
            ? h('div', { className: 'dsc-quad-empty' }, quadrant.hint)
            : h('div', { className: 'dsc-quad-list' },
              shown.map((project) => h('div', { key: project.id, className: 'dsc-quad-item' },
                h('span', { className: 'dsc-quad-item-name', title: project.name }, project.name))),
              hidden > 0 || (open && rows.length > QUAD_VISIBLE)
                ? h('div', { className: 'dsc-quad-more' },
                  open && rows.length > QUAD_VISIBLE ? '收起' : '…还有 ' + hidden + ' 个')
                : null));
      };

      return h('div', { className: 'dsc-matrix' },
        h('div', { className: 'dsc-matrix-body' },
          h('div', { className: 'dsc-axis-y' },
            h('span', { className: 'dsc-axis-tip' }, '重要'),
            h('span', { className: 'dsc-axis-line' }),
            h('span', { className: 'dsc-axis-tip' }, '不重要')),
          h('div', { className: 'dsc-matrix-grid' },
            cell('important-not-urgent'),
            cell('important-urgent'),
            cell('neither'),
            cell('urgent-not-important'))),
        h('div', { className: 'dsc-axis-x' },
          h('span', { className: 'dsc-axis-tip' }, '不紧急'),
          h('span', { className: 'dsc-axis-line-h' }),
          h('span', { className: 'dsc-axis-tip' }, '紧急')));
    }

    function Progress({ value }) {
      const safe = Math.max(0, Math.min(100, Number(value) || 0));
      return h('div', { className: 'dsc-progress' },
        h('div', { className: 'dsc-bar' },
          h('div', { className: 'dsc-barfill', style: { width: safe + '%' } })),
        h('div', { className: 'dsc-pct' }, safe + '%'));
    }

    function Empty({ children }) {
      return h('div', { className: 'dsc-empty' }, children);
    }

    function ErrorNote({ message }) {
      if (!message) return null;
      return h('div', { className: 'dsc-error' },
        '读取失败：' + message,
        h('div', { style: { marginTop: 4, opacity: 0.8 } },
          '若显示 404，说明宿主半侧还没加载：重启一次 DSH 即可。'));
    }

    function doneCount(project) {
      return (project.milestones || []).filter((m) => m.done).length;
    }

    const STAGE_ROLE = {
      zhongshu: 'zhongshu',
      menxia: 'menxia',
      shangshu: 'shangshu',
      executing: 'executor',
      review: 'menxia',
    };

    /** 当前环节真正在干活的会话；没有就退回最近有会话的那一方。 */
    function stageSession(project) {
      const role = STAGE_ROLE[project.status];
      if (role) {
        const dept = project.departments[role];
        if (dept && dept.sessionId) return dept.sessionId;
      }
      for (const key of ['executor', 'shangshu', 'menxia', 'zhongshu']) {
        const dept = project.departments[key];
        if (dept && dept.sessionId) return dept.sessionId;
      }
      return null;
    }

    function timeAgo(ts) {
      if (!ts) return '刚刚';
      const diff = Date.now() - ts;
      if (diff < 60 * 1000) return '刚刚';
      if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
      return Math.floor(diff / 86400000) + ' 天前';
    }

    function ProjectRow({ project, onClick }) {
      return h('div', {
        className: 'dsc-card' + (onClick ? ' dsc-card--click' : ''),
        role: onClick ? 'button' : undefined,
        tabIndex: onClick ? 0 : undefined,
        onClick,
        onKeyDown: onClick
          ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onClick();
            }
          }
          : undefined,
      },
        h('div', { className: 'dsc-row' },
          h('div', { className: 'dsc-rowmain' },
            h(Badge, { status: project.status }),
            h('span', { className: 'dsc-name', title: project.name }, project.name)),
          h(Progress, { value: project.progress })),
        project.description ? h('div', { className: 'dsc-desc' }, project.description) : null,
        h('div', { className: 'dsc-meta' },
          h('span', null, doneCount(project) + '/' + project.milestones.length + ' 里程碑'),
          h('span', null, '更新 ' + timeAgo(project.updatedAt)),
          h(HealthDot, { project }),
          PriorityChip({ project }),
          packageText(project) ? h('span', null, packageText(project)) : null,
          project.rounds > 0 ? h('span', null, '驳回 ' + project.rounds + ' 轮') : null,
          project.workspace && project.workspace.path
            ? h('span', { className: 'dsc-mono' }, project.workspace.path)
            : null));
    }

    // 心跳徽章：宿主算好的事实，客户端只负责显示。
    // 宿主是旧版时 project.health 不存在，这里整块消失，不会报错。
    function PriorityChip({ project }) {
      const key = quadrantOf(project);
      if (key === 'neither') return null;
      const quadrant = QUADRANT_BY_KEY[key];
      return h('span', {
        className: 'dsc-quadchip',
        style: { color: quadrant.color, borderColor: quadrant.color },
        title: '重要 / 紧急：' + quadrant.label,
      }, quadrant.label);
    }

    function packageText(project) {
      const list = project && Array.isArray(project.packages) ? project.packages : [];
      if (list.length === 0) return '';
      const merged = list.filter((pkg) => pkg.state === 'merged').length;
      const doing = list.filter((pkg) => pkg.state === 'doing').length;
      const blocked = list.filter((pkg) => pkg.state === 'blocked').length;
      return '工单 ' + merged + '/' + list.length
        + (doing > 0 ? '（' + doing + ' 进行中）' : '')
        + (blocked > 0 ? '（' + blocked + ' 阻塞）' : '');
    }
    function HealthDot({ project }) {
      const health = project && project.health;
      if (!health || health.state === 'settled' || health.state === 'idle') return null;
      const color = health.level === 'bad' ? '#e5484d' : health.level === 'warn' ? '#f5a524' : '#30a46c';
      return h('span', { className: 'dsc-health', title: project.healthText || health.label },
        h('span', { className: 'dsc-health-dot', style: { background: color } }),
        health.label);
    }

    function ProjectMiniRow({ project, onClick }) {
      return h('div', {
        className: 'dsc-card' + (onClick ? ' dsc-card--click' : ''),
        role: onClick ? 'button' : undefined,
        tabIndex: onClick ? 0 : undefined,
        onClick,
        onKeyDown: onClick
          ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onClick();
            }
          }
          : undefined,
      },
        h('div', { className: 'dsc-row' },
          h('div', { className: 'dsc-rowmain' },
            h(Badge, { status: project.status }),
            h('span', { className: 'dsc-name', title: project.name }, project.name)),
          h('span', { className: 'dsc-meta' }, timeAgo(project.updatedAt))),
        h('div', { className: 'dsc-meta', style: { marginTop: 6 } },
          h('span', null, doneCount(project) + '/' + project.milestones.length + ' 里程碑'),
          h('span', null, shapeShort(project)),
          h(LineageChip, { project }),
          h(HealthDot, { project }),
          PriorityChip({ project }),
          project.status === 'draft' ? h('span', { className: 'dsc-draft-hint' }, '待秘书接手') : null,
          project.rounds > 0 ? h('span', null, '驳回 ' + project.rounds + ' 轮') : null));
    }

    function DeptNode({ dept, meta, project, onJump }) {
      const assigned = Boolean(dept && dept.sessionId);
      const active = project.status === meta.key ||
        (meta.key === 'executor' && (project.status === 'executing' || project.status === 'review'));
      return h('div', { className: 'dsc-node' + (active ? ' dsc-node--active' : '') },
        h('div', { className: 'dsc-node-order' }, meta.order),
        h('div', null,
          h('div', { className: 'dsc-node-role' }, meta.role),
          h('div', { className: 'dsc-node-province' }, meta.province)),
        h('div', { className: 'dsc-node-foot' },
          assigned
            ? h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--sm',
              onClick: () => onJump(dept.sessionId),
            }, '打开会话')
            : h('span', { className: 'dsc-node-province' }, '未分配')));
    }

    // ---------------------------------------------------------------------
    // 四个区的内容
    // ---------------------------------------------------------------------

    function SessionCleaner() {
      const [rows, setRows] = React.useState(null);
      const [selected, setSelected] = React.useState({});
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);

      const load = React.useCallback(async () => {
        try {
          const data = await courtApi.sessions();
          setRows(data.sessions || []);
        } catch (failure) {
          setMessage('读取会话失败：' + (failure && failure.message ? failure.message : String(failure)));
        }
      }, []);

      React.useEffect(() => {
        void load();
      }, [load]);

      const toggle = (id) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
      const chosen = Object.keys(selected).filter((id) => selected[id]);
      const all = rows || [];
      const courtRows = all.filter((row) => (row.group || 'court') !== 'dsh');
      const otherRows = all.filter((row) => row.group === 'dsh');
      const [showOthers, setShowOthers] = React.useState(false);
      const visible = showOthers ? all : courtRows;

      const selectAll = (on) => {
        const next = {};
        if (on) for (const row of visible) next[row.sessionId] = true;
        setSelected(next);
      };

      const archive = async () => {
        if (chosen.length === 0 || busy) return;
        setBusy(true);
        try {
          const result = await courtApi.archiveSessions(chosen);
          const failed = result.failed || [];
          setMessage(
            `已归档 ${result.archived.length} 个会话`
            + (failed.length > 0 ? `，失败 ${failed.length} 个：${failed[0].message}` : ''),
          );
          setSelected({});
          await load();
        } catch (failure) {
          setMessage('归档失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setBusy(false);
        }
      };

      return h('section', { className: 'dsc-section' },
        h('div', { className: 'dsc-section-head' },
          h('span', { className: 'dsc-section-title' }, '会话清理'),
          h('span', { className: 'dsc-section-hint' },
            rows === null
              ? '读取中…'
              : (courtRows.length + ' 个由万象工阁产生'
                + (otherRows.length > 0 ? `，另有 ${otherRows.length} 个你的普通会话` : '')))),
        h('div', { className: 'dsc-card' },
          rows === null
            ? h('div', { className: 'dsc-note' }, '读取中…')
            : visible.length === 0
              ? h('div', { className: 'dsc-note' },
                showOthers ? '这个工作区没有会话。' : '没有由万象工阁产生的会话。')
              : h('div', null,
                h('div', { className: 'dsc-actions', style: { marginTop: 0, marginBottom: 6 } },
                  h('button', {
                    type: 'button',
                    className: 'dsc-btn dsc-btn--sm',
                    onClick: () => selectAll(true),
                  }, '全选'),
                  h('button', {
                    type: 'button',
                    className: 'dsc-btn dsc-btn--sm',
                    onClick: () => selectAll(false),
                  }, '清空'),
                  otherRows.length > 0
                    ? h('button', {
                      type: 'button',
                      className: 'dsc-btn dsc-btn--sm',
                      onClick: () => { setShowOthers((v) => !v); setSelected({}); },
                    }, showOthers ? '只看万象工阁的' : `连普通会话一起看（${otherRows.length}）`)
                    : null,
                  h('button', {
                    type: 'button',
                    className: 'dsc-btn dsc-btn--sm dsc-btn--danger',
                    disabled: chosen.length === 0 || busy,
                    onClick: archive,
                  }, busy ? '归档中…' : '归档选中（' + chosen.length + '）')),
                visible.map((row) => h('button', {
                  key: row.sessionId,
                  type: 'button',
                  role: 'checkbox',
                  className: 'dsc-check',
                  'aria-checked': Boolean(selected[row.sessionId]),
                  onClick: () => toggle(row.sessionId),
                },
                  h('span', { className: 'dsc-box', 'aria-hidden': true },
                    selected[row.sessionId] ? h(Icon, { name: 'check', size: 11 }) : null),
                  h('span', { className: 'dsc-checktext' }, row.title),
                  h('span', { className: 'dsc-weight' },
                    row.group === 'dsh' ? '普通会话' : (row.role || '万象工阁'))))),
          message ? h('div', { className: 'dsc-flash' }, message) : null));
    }

    function SecretaryView({ data, error, onGo, onSay }) {
      const counts = (data && data.counts) || { total: 0, active: 0, blocked: 0 };
      const projects = (data && data.projects) || [];
      const todo = projects
        .map((project) => ({
          project,
          open: (project.questions || []).filter((question) => question.status === 'open'),
        }))
        .filter((entry) => entry.open.length > 0 || entry.project.status === 'blocked');
      const todoIds = new Set(todo.map((entry) => entry.project.id));
      const recent = projects.filter((project) => !todoIds.has(project.id)).slice(0, 5);
      const [draft, setDraft] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [problem, setProblem] = React.useState(null);

      const send = async () => {
        const text = draft.trim();
        if (!text || busy) return;
        setBusy(true);
        setProblem(null);
        try {
          await onSay(text);
          setDraft('');
        } catch (failure) {
          setProblem(failure && failure.message ? failure.message : String(failure));
        } finally {
          setBusy(false);
        }
      };

      return h('div', null,
        h(ErrorNote, { message: error }),
        h('div', { className: 'dsc-card', style: { marginTop: 16 } },
          h('div', { className: 'dsc-row', style: { marginTop: 0 } },
            h('div', { className: 'dsc-label' }, '跟秘书说一句话'),
            h('span', { className: 'dsc-note' }, 'Ctrl+Enter 发送')),
          h('div', { className: 'dsc-chips', style: { marginTop: 8 } },
            ['把首页改快一点，首屏 1 秒内打开', '先跑起来，能演示就行', '现在最该先做哪个项目？']
              .map((example) => h('button', {
                key: example,
                type: 'button',
                className: 'dsc-chip',
                onClick: () => setDraft(example),
              }, example))),
          h('textarea', {
            className: 'dsc-textarea',
            style: { marginTop: 10 },
            value: draft,
            placeholder: '例如：帮我把锦盏藏华的首页改快一点，验收标准是首屏 1 秒内打开',
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void send();
              }
            },
          }),
          problem ? h('div', { className: 'dsc-error' }, '发送失败：' + problem) : null,
          h('div', { className: 'dsc-toolbar', style: { marginTop: 12, justifyContent: 'space-between' } },
            h('span', { className: 'dsc-note' }, '秘书会立项并交给架构师'),
            h('div', { className: 'dsc-toolbar' },
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--sm',
                onClick: () => onGo('hall', null, 'create'),
              }, '＋ 手动立项'),
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--primary',
                disabled: !draft.trim() || busy,
                onClick: () => void send(),
              }, busy ? '交给秘书…' : '交给秘书')))),
        h('div', { className: 'dsc-matrix-row' },
          h(QuadrantMatrix, { projects }),
          h('div', { className: 'dsc-stat-col' },
            h(Stat, { value: counts.total, label: '项目总数' }),
            h(Stat, { value: counts.active, label: '进行中' }),
            h(Stat, { value: counts.paused || 0, label: '已暂停' }),
            h(Stat, { value: counts.blocked, label: '等你决定' }))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '需要你处理'),
            h('span', { className: 'dsc-section-hint' }, todo.length + ' 项')),
          todo.length === 0
            ? h(Empty, null, '现在没有卡在你这里的项目。')
            : h('div', { className: 'dsc-list' },
              todo.map(({ project, open }) => {
                const go = () => onGo('hall', null, 'petitions');
                const problem = open.length > 0
                  ? open[0].question
                  : (project.blockedReason || '等待你处理');
                return h('div', {
                  key: project.id,
                  className: 'dsc-card dsc-card--click',
                  role: 'button',
                  tabIndex: 0,
                  onClick: go,
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      go();
                    }
                  },
                },
                  h('div', { className: 'dsc-row' },
                    h('div', { className: 'dsc-rowmain' },
                      h(Badge, { status: project.status }),
                      h('span', { className: 'dsc-name' }, project.name)),
                    h('span', { className: 'dsc-meta' },
                      open.length > 1 ? open.length + ' 条待批' : timeAgo(project.updatedAt))),
                  h('div', { className: 'dsc-desc' }, problem),
                  h('div', { className: 'dsc-actions' },
                    h('button', {
                      type: 'button',
                      className: 'dsc-btn dsc-btn--sm dsc-btn--primary',
                      onClick: (event) => {
                        event.stopPropagation();
                        go();
                      },
                    }, '去批奏疏')));
              }))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '项目速览'),
            h('span', { className: 'dsc-section-hint' }, todoIds.size > 0 ? '其余项目' : '最近更新')),
          recent.length === 0
            ? h(Empty, null, todoIds.size > 0
              ? '其余项目为空；需要你处理的项目已在上方。'
              : '还没有项目。去「项目看板」新建一个，或者在秘书会话里说一句你要做什么。')
            : h('div', { className: 'dsc-list' },
              recent.map((project) => h(ProjectMiniRow, {
                key: project.id,
                project,
                onClick: () => onGo('hall', project.id),
              })))),
        h(SessionCleaner, null),
        h('div', { className: 'dsc-note', style: { marginTop: 24 } },
          '手动立项会直接把项目交给接单台；如果秘书没收到，立项成功页会给你「再叫一次秘书」。' +
          '其余情况直接在会话里说一句，秘书会先追问，再决定轻量还是项目组。'));
    }

    function ChancelleryView({ data, error, jump }) {
      const projects = (data && data.projects) || [];

      const onJump = (sessionId) => {
        if (typeof jump === 'function' && jump(sessionId)) return;
      };

      if (projects.length === 0) {
        return h('div', null,
          h(ErrorNote, { message: error }),
          h(Empty, null, '还没有可推进的项目。先到「项目看板」新建一个。'));
      }

      return h('div', null,
        h(ErrorNote, { message: error }),
        h('div', { className: 'dsc-note', style: { marginTop: 16 } },
          '每个项目一条独立的工位链；点节点上的「打开会话」直接跳到对应岗位的会话。'),
        projects.map((project) => h('section', { key: project.id, className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('div', { className: 'dsc-rowmain' },
              h(Badge, { status: project.status }),
              h('span', { className: 'dsc-name' }, project.name),
              h('span', { className: 'dsc-meta' }, shapeShort(project)),
              h(LineageChip, { project })),
            h('div', { className: 'dsc-row', style: { marginTop: 0 } },
              h(Progress, { value: project.progress }))),
          h('div', { className: 'dsc-pipe', style: { marginTop: 12 } },
            DEPTS.map((meta) => h(DeptNode, {
              key: meta.key,
              meta,
              dept: project.departments[meta.key],
              project,
              onJump,
            }))),
          h('div', { className: 'dsc-meta', style: { marginTop: 8 } },
            h('span', null, '更新 ' + timeAgo(project.updatedAt)),
            project.rounds > 0 ? h('span', null, '驳回 ' + project.rounds + ' 轮') : null,
            project.blockedReason ? h('span', null, '卡点：' + project.blockedReason) : null))));
    }

    function CreateForm({ onCreated, onCancel, onOpenSession }) {
      const [name, setName] = React.useState('');
      const [description, setDescription] = React.useState('');
      const [workspacePath, setWorkspacePath] = React.useState('');
      const [shape, setShape] = React.useState('squad');
      const [important, setImportant] = React.useState(false);
      const [urgent, setUrgent] = React.useState(false);
      const [vaultAccess, setVaultAccess] = React.useState(true);
      const [busy, setBusy] = React.useState(false);
      const [problem, setProblem] = React.useState(null);
      const [result, setResult] = React.useState(null);
      const [files, setFiles] = React.useState([]);
      const [dragOver, setDragOver] = React.useState(false);
      const [refDrafts, setRefDrafts] = React.useState([]);
      const [refPicking, setRefPicking] = React.useState(false);
      const fileInput = React.useRef(null);

      const cleanedPath = cleanPath(workspacePath);

      /** 立项词里带上附件和参考的说明，秘书接手时就知道去哪儿看。 */
      const briefOf = (project, uploaded, refs) => {
        let text = manualSecretaryBrief(project, cleanedPath, uploaded);
        if (Array.isArray(refs) && refs.length > 0) {
          text += '\n项目参考：已加入 ' + refs.length + ' 段（来自会话记录），用 court_get_project view=work 查看。';
        }
        return text;
      };

      /** 收下拖进来/选中的文件：最多 10 个、单个 40MB，重名同大小去重。 */
      const addFiles = (list) => {
        const incoming = Array.from(list || []);
        if (incoming.length === 0) return;
        setFiles((prev) => {
          const next = [...prev];
          for (const file of incoming) {
            if (next.length >= 10) break;
            if (!file || file.size > 40 * 1024 * 1024) continue;
            if (next.some((item) => item.name === file.name && item.size === file.size)) continue;
            next.push(file);
          }
          return next;
        });
      };

      const dropHandlers = {
        onDragOver: (event) => {
          event.preventDefault();
          setDragOver(true);
        },
        onDragEnter: (event) => {
          event.preventDefault();
          setDragOver(true);
        },
        onDragLeave: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false);
        },
        onDrop: (event) => {
          event.preventDefault();
          setDragOver(false);
          addFiles(event.dataTransfer && event.dataTransfer.files);
        },
      };

      const finish = async (next) => {
        setResult(next);
        if (typeof onCreated === 'function') {
          try {
            await onCreated(next);
          } catch {
            /* 父级刷新失败不影响立项结果 */
          }
        }
      };

      const submit = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        setProblem(null);
        try {
          const created = await courtApi.create({
            name: name.trim(),
            description: description.trim(),
            workspacePath: cleanedPath,
            shape,
            vaultAccess,
            important,
            urgent,
          });
          const project = created && created.project ? created.project : null;
          if (!project) throw new Error('宿主没有返回项目对象');
          const uploaded = [];
          const failedFiles = [];
          for (const file of files) {
            try {
              const saved = await uploadAttachmentFile(project.id, file);
              if (saved && saved.attachment) uploaded.push(saved.attachment);
            } catch (failure) {
              failedFiles.push((file.name || '文件') + '：' + (failure && failure.message ? failure.message : String(failure)));
            }
          }
          let secretary = null;
          let warning = null;
          const savedRefs = [];
          for (const draft of refDrafts) {
            try {
              await courtApi.addReference({ projectId: project.id, ...draft });
              savedRefs.push(draft);
            } catch {
              /* 参考存不进去不该挡住立项 */
            }
          }
          try {
            secretary = await tellSecretary(briefOf(project, uploaded, savedRefs));
          } catch (failure) {
            warning = failure && failure.message ? failure.message : String(failure);
          }
          if (failedFiles.length > 0) {
            warning = (warning ? warning + '；' : '') + failedFiles.length + ' 个附件没传上：' + failedFiles.join('；');
          }
          await finish({ project, secretary, warning, uploaded, refs: savedRefs });
        } catch (failure) {
          setProblem(failure && failure.message ? failure.message : String(failure));
        } finally {
          setBusy(false);
        }
      };

      const retrySecretary = async () => {
        if (!result || busy) return;
        setBusy(true);
        try {
          const secretary = await tellSecretary(briefOf(result.project, result.uploaded || [], result.refs || []));
          await finish({ ...result, secretary, warning: null });
        } catch (failure) {
          await finish({
            ...result,
            warning: failure && failure.message ? failure.message : String(failure),
          });
        } finally {
          setBusy(false);
        }
      };

      if (result) {
        const project = result.project;
        const secretaryOk = Boolean(result.secretary && result.secretary.sessionId);
        return h('div', { className: 'dsc-form' },
          h('div', { className: 'dsc-done' },
            h('div', { className: 'dsc-done-title' },
              h('span', { className: 'dsc-done-icon' }, h(Icon, { name: 'check', size: 12 })),
              '已立项：' + project.name),
            h('div', { className: 'dsc-note' },
              shapeFull(project) + '模式',
              cleanedPath ? h('span', { className: 'dsc-mono' }, ' · ' + cleanedPath) : ' · 工作区待定'),
            result.uploaded && result.uploaded.length > 0
              ? h('div', { className: 'dsc-note' },
                '附件 ' + result.uploaded.length + ' 个已存进项目：'
                + result.uploaded.map((item) => item.name).join('、'))
              : null,
            result.refs && result.refs.length > 0
              ? h('div', { className: 'dsc-note' },
                '项目参考 ' + result.refs.length + ' 段已加入：'
                + result.refs.map((item) => item.sessionLabel).join('、'))
              : null,
            secretaryOk
              ? h('div', { className: 'dsc-flash dsc-flash--ok', style: { marginTop: 0 } },
                '接单台已收到，正在读项目并接手。')
              : h('div', { className: 'dsc-flash dsc-flash--warn', style: { marginTop: 0 } },
                '项目已建好，但接单台没被叫醒：' + (result.warning || '未知原因')
                + '。你可以点「再叫一次秘书」，或直接在秘书会话里说一句。'),
            h('div', { className: 'dsc-actions', style: { marginTop: 4 } },
              secretaryOk && typeof onOpenSession === 'function'
                ? h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--primary',
                  onClick: () => {
                    if (!onOpenSession(result.secretary.sessionId)) {
                      setProblem('会话已创建，但界面跳不过去；请到侧栏「万象工阁」工作区里找它。');
                    }
                  },
                }, '打开秘书会话')
                : null,
              !secretaryOk
                ? h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--primary',
                  disabled: busy,
                  onClick: () => void retrySecretary(),
                }, busy ? '再叫中…' : '再叫一次秘书')
                : null,
              h('button', {
                type: 'button',
                className: 'dsc-btn',
                onClick: onCancel,
              }, '完成'))),
          problem ? h('div', { className: 'dsc-error' }, problem) : null);
      }

      return h('div', { className: 'dsc-form', ...dropHandlers },
        h('div', { className: 'dsc-form-head' },
          h('div', null,
            h('div', { className: 'dsc-form-title' }, '新建项目'),
            h('div', { className: 'dsc-form-desc' },
              '填最少的必填项就能立项；立项后秘书会自动接手。')),
          h('button', { type: 'button', className: 'dsc-btn dsc-btn--sm', onClick: onCancel }, '收起')),
        h('div', { className: 'dsc-form-body' },
          h('div', { className: 'dsc-grid' },
            h('div', { className: 'dsc-opt' },
              h('label', { className: 'dsc-label' }, '项目名'),
              h('input', {
                className: 'dsc-input',
                value: name,
                autoFocus: true,
                placeholder: '例如：锦盏藏华小程序 1.2 改版',
                onChange: (event) => setName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void submit();
                  }
                },
              })),
            h('div', { className: 'dsc-opt' },
              h('label', { className: 'dsc-label' }, '编制'),
              h('div', { className: 'dsc-seg', role: 'group', 'aria-label': '项目编制' },
                h('button', {
                  type: 'button',
                  className: 'dsc-seg-btn',
                  'aria-pressed': shape === 'squad' ? 'true' : 'false',
                  onClick: () => setShape('squad'),
                }, '轻量组 · 推荐'),
                h('button', {
                  type: 'button',
                  className: 'dsc-seg-btn',
                  'aria-pressed': shape === 'crew' ? 'true' : 'false',
                  onClick: () => setShape('crew'),
                }, '项目组'),
                h('button', {
                  type: 'button',
                  className: 'dsc-seg-btn',
                  'aria-pressed': shape === 'line' ? 'true' : 'false',
                  onClick: () => setShape('line'),
                }, '流水线')),
              h('div', { className: 'dsc-note' },
                shape === 'squad'
                  ? '架构师出契约 → 交付工程师审完自己动手 → 交付秘书抽验。两个会话，不设评审。'
                  : shape === 'crew'
                    ? '架构师 → 评审 → 项目经理 → 工程师，多一道第三方把关。'
                    : '架构 → 调度 → 多个工程师并行，一次派一批同构工单。'))),
          h('div', { className: 'dsc-opt' },
            h('label', { className: 'dsc-label' }, '一句话需求（秘书/架构师会继续追问）'),
            h('textarea', {
              className: 'dsc-textarea',
              value: description,
              placeholder: '想解决什么问题、给谁用、什么算做完',
              onChange: (event) => setDescription(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void submit();
                }
              },
            })),
          h('div', { className: 'dsc-opt' },
            h('label', { className: 'dsc-label' }, '重要 / 紧急'),
            h('div', { className: 'dsc-seg', role: 'group', 'aria-label': '优先级' },
              h('button', {
                type: 'button',
                className: 'dsc-seg-btn',
                'aria-pressed': important ? 'true' : 'false',
                onClick: () => setImportant(!important),
              }, important ? '● 重要' : '○ 重要'),
              h('button', {
                type: 'button',
                className: 'dsc-seg-btn',
                'aria-pressed': urgent ? 'true' : 'false',
                onClick: () => setUrgent(!urgent),
              }, urgent ? '● 紧急' : '○ 紧急')),
            h('div', { className: 'dsc-note' },
              '当前：' + QUADRANT_BY_KEY[quadrantOf({ priority: { important, urgent } })].label
              + '（默认两个都不选 = 不重要也不紧急，排在后面，不插队）')),
          h('div', { className: 'dsc-grid' },
            h('div', { className: 'dsc-opt' },
              h('label', { className: 'dsc-label' }, '工作区（可留空）'),
              h('input', {
                className: 'dsc-input dsc-mono',
                value: workspacePath,
                placeholder: 'D:\\project\\your-project',
                onChange: (event) => setWorkspacePath(event.target.value),
              }),
              h('div', { className: 'dsc-note' },
                cleanedPath ? '会直接作为项目工作区；首尾引号已自动去掉。' : '留空时由秘书或项目管理和你确认目录。')),
            h('div', { className: 'dsc-opt' },
              h('label', { className: 'dsc-label' }, '知识库'),
              h('div', { className: 'dsc-seg', role: 'group', 'aria-label': '知识库权限' },
                h('button', {
                  type: 'button',
                  className: 'dsc-seg-btn',
                  'aria-pressed': vaultAccess ? 'true' : 'false',
                  onClick: () => setVaultAccess(true),
                }, '允许浏览'),
                h('button', {
                  type: 'button',
                  className: 'dsc-seg-btn',
                  'aria-pressed': vaultAccess ? 'false' : 'true',
                  onClick: () => setVaultAccess(false),
                }, '不允许')),
              h('div', { className: 'dsc-note' },
                vaultAccess ? '项目里的 Agent 可只读检索知识库。' : '不能读；结项后仍可手动收进。')))),
        h('div', { className: 'dsc-drop' + (dragOver ? ' dsc-drop--hot' : '') },
          h('div', { className: 'dsc-row', style: { marginTop: 0 } },
            h('span', { className: 'dsc-label' }, '项目附件'),
            h('span', { className: 'dsc-note' }, dragOver ? '松手就加上' : '把需求文档、截图、参考代码拖进来')),
          h('div', { className: 'dsc-actions', style: { justifyContent: 'flex-start' } },
            h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--sm',
              onClick: () => {
                if (fileInput.current) fileInput.current.click();
              },
            }, '选择文件'),
            h('span', { className: 'dsc-note' },
              files.length > 0 ? files.length + ' 个已选（单文件上限 40MB）' : '也可以直接拖到这张表单上')),
          h('input', {
            ref: fileInput,
            type: 'file',
            multiple: true,
            style: { display: 'none' },
            onChange: (event) => {
              addFiles(event.target.files);
              event.target.value = '';
            },
          }),
          files.length > 0
            ? h('div', null, files.map((file, index) => h('span', {
              key: (file.name || 'file') + index,
              className: 'dsc-filechip',
            },
              h('b', { title: file.name }, file.name),
              h('span', null, formatBytes(file.size)),
              h('button', {
                type: 'button',
                'aria-label': '移除 ' + file.name,
                onClick: () => setFiles((prev) => prev.filter((_, position) => position !== index)),
              }, '×'))))
            : null),
        h('div', { className: 'dsc-drop' },
          h('div', { className: 'dsc-row', style: { marginTop: 0 } },
            h('span', { className: 'dsc-label' }, '项目参考'),
            h('span', { className: 'dsc-note' }, '从任何会话里挑几句聊天记录，立项后自动带进这个项目')),
          h('div', { className: 'dsc-actions', style: { justifyContent: 'flex-start' } },
            h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--sm',
              onClick: () => setRefPicking(true),
            }, '＋ 从会话里选…'),
            h('span', { className: 'dsc-note' },
              refDrafts.length > 0
                ? refDrafts.length + ' 段 · ' + refDrafts.reduce((sum, item) => sum + item.items.length, 0) + ' 条消息'
                : '还没选（可跳过）')),
          refDrafts.length > 0
            ? h('div', null, refDrafts.map((draft, index) => h('span', {
              key: draft.sessionId + '-' + index,
              className: 'dsc-filechip',
            },
              h('b', { title: draft.sessionLabel }, draft.sessionLabel),
              h('span', null, draft.items.length + ' 条'),
              h('button', {
                type: 'button',
                'aria-label': '移除 ' + draft.sessionLabel,
                onClick: () => setRefDrafts((prev) => prev.filter((_, position) => position !== index)),
              }, '×'))))
            : null),
        problem ? h('div', { className: 'dsc-error' }, '创建失败：' + problem) : null,
        h('div', { className: 'dsc-formfoot' },
          h('span', { className: 'dsc-note' }, 'Ctrl+Enter 立项'),
          h('button', { type: 'button', className: 'dsc-btn', onClick: onCancel }, '取消'),
          h('button', {
            type: 'button',
            className: 'dsc-btn dsc-btn--primary',
            disabled: !name.trim() || busy,
            onClick: () => void submit(),
          }, busy ? '立项并通知秘书…' : '立项')),
        refPicking
          ? h(ReferencePicker, {
            title: '立项参考 · 从会话里挑几句',
            onClose: () => setRefPicking(false),
            onPick: (selection) => {
              setRefDrafts((prev) => [...prev, selection]);
            },
          })
          : null);
    }

    function ProjectDetail({ project, refresh, onJump, onBack }) {
      const [flash, setFlash] = React.useState(null);
      const [rejecting, setRejecting] = React.useState(false);
      const [reason, setReason] = React.useState('');
      const [vaultBusy, setVaultBusy] = React.useState(false);
      const [vaultMessage, setVaultMessage] = React.useState(null);
      const [vaultImport, setVaultImport] = React.useState(null);
      const [notifyBusy, setNotifyBusy] = React.useState(false);

      const checkVault = async () => {
        if (vaultBusy) return;
        setVaultBusy(true);
        try {
          const result = await courtApi.vaultStatus(project.id);
          setVaultImport(result.status || null);
          setVaultMessage(
            result.status && result.status.done
              ? `LLM Wiki 已导入 ${result.status.importedCount} 页：`
                + (result.status.imported[0] ? result.status.imported[0].rel : '')
              : 'raw 已投递，LLM Wiki 还没导入；稍等再点「检查导入」。',
          );
        } catch (failure) {
          setVaultMessage('检查失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setVaultBusy(false);
        }
      };

      const intakeVault = async () => {
        if (vaultBusy) return;
        setVaultBusy(true);
        setVaultMessage(null);
        try {
          const result = await courtApi.vaultIntake(project.id);
          const rel = result.files && result.files[0] ? result.files[0].rel : (result.path || '');
          setVaultImport(result.status || null);
          setVaultMessage(
            (result.skipped ? '内容没变，已跳过：' : '已投递原始资料：') + rel
            + (result.status && result.status.done
              ? `；LLM Wiki 已导入 ${result.status.importedCount} 页。`
              : '；等待 LLM Wiki 的 source watcher 导入，稍后点「检查导入」。')
            + (result.resolved && result.resolved !== 'configured' ? '（路径已自动纠正）' : ''),
          );
          await refresh();
        } catch (failure) {
          setVaultMessage('写入失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setVaultBusy(false);
        }
      };

      const patch = async (value) => {
        try {
          await courtApi.patch(project.id, value);
          await refresh();
        } catch (failure) {
          setFlash('操作失败：' + (failure && failure.message ? failure.message : String(failure)));
        }
      };

      const toggle = async (milestone) => {
        try {
          await courtApi.toggle(project.id, milestone.id, !milestone.done);
          await refresh();
        } catch (failure) {
          setFlash('操作失败：' + (failure && failure.message ? failure.message : String(failure)));
        }
      };

      const wakeSecretary = async () => {
        if (notifyBusy) return;
        setNotifyBusy(true);
        setFlash('正在叫醒接单台…');
        try {
          const result = await tellSecretary(manualSecretaryBrief(
            project,
            project.workspace && project.workspace.path,
          ));
          setFlash('接单台已收到（会话 ' + result.sessionId + '），它会先读项目再决定下一步。');
          await refresh();
        } catch (failure) {
          setFlash('叫醒失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setNotifyBusy(false);
        }
      };

      const next = NEXT_STEP[project.status];
      const stageRole = STAGE_ROLE[project.status];
      const hasStageSession = Boolean(
        stageRole && project.departments[stageRole] && project.departments[stageRole].sessionId,
      );
      const showNext = Boolean(next) && (
        project.status === 'review'
        || project.status === 'blocked'
        || (project.status !== 'draft' && !hasStageSession)
      );

      const sessionRows = [];
      const seenSessions = new Set();
      for (const meta of DEPTS) {
        const dept = project.departments[meta.key];
        if (dept && dept.sessionId && !seenSessions.has(dept.sessionId)) {
          seenSessions.add(dept.sessionId);
          sessionRows.push({ id: dept.sessionId, label: meta.role + ' · ' + meta.province, live: true });
        }
      }
      for (const sessionId of project.retiredSessions || []) {
        if (!sessionId || seenSessions.has(sessionId)) continue;
        seenSessions.add(sessionId);
        sessionRows.push({ id: sessionId, label: '历史会话', live: false });
      }

      const sessionList = h('div', { className: 'dsc-list' },
        sessionRows.map((row) => h('div', { key: row.id, className: 'dsc-card' },
          h('div', { className: 'dsc-row' },
            h('div', { className: 'dsc-rowmain' },
              h('span', { className: 'dsc-badge dsc-tone-' + (row.live ? 'ok' : 'neutral') },
                row.live ? '当前' : '历史'),
              h('span', { className: 'dsc-name' }, row.label)),
            h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--sm',
              onClick: () => onJump(row.id),
            }, '打开会话')))));

      return h('div', null,
        h('div', { className: 'dsc-row', style: { marginTop: 16 } },
          h('button', { type: 'button', className: 'dsc-btn dsc-btn--sm', onClick: onBack }, '← 返回项目库'),
          h(Badge, { status: project.status }),
          h('span', { className: 'dsc-meta' }, shapeShort(project)),
          h(LineageChip, { project })),
        h('div', { className: 'dsc-row', style: { marginTop: 12, alignItems: 'flex-start' } },
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'dsc-name', style: { fontSize: 20, whiteSpace: 'normal' } }, project.name),
            h('div', { className: 'dsc-desc' }, project.description || '还没有需求描述。')),
          h(Progress, { value: project.progress })),
        project.status === 'draft'
          ? h('div', { className: 'dsc-flash dsc-flash--warn', style: { marginTop: 10 } },
            '项目还在草拟。点「叫醒秘书接手」让接单台继续；想跳过秘书，也可以直接点「启动流程」交架构。')
          : null,
        project.scope && project.scope.drift && project.scope.confirmedAt < project.scope.drift.at
          ? h('div', { className: 'dsc-flash', style: { background: 'rgba(220,120,40,.14)' } },
            '需求可能漂移：' + (project.scope.drift.reason || '方案相对已批准范围有 material 变更')
            + '。请确认后再派活/结项（court_confirm_scope）。',
            h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--sm',
              style: { marginLeft: 10 },
              onClick: async () => {
                try {
                  await courtApi.confirmScope(project.id, '用户在项目页确认基线');
                  await refresh();
                } catch (failure) {
                  setFlash('确认失败：' + (failure && failure.message ? failure.message : String(failure)));
                }
              },
            }, '确认基线'))
          : null,
        project.status === 'blocked' && project.progress >= 100
          ? h('div', { className: 'dsc-note' },
            '里程碑已经走完，当前是在等你确认/解阻，不是还有施工项。')
          : null,
        h('div', { className: 'dsc-actions', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
          h('div', { className: 'dsc-toolbar' },
          showNext
            ? h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--primary',
              onClick: () => patch({ status: next.status }),
            }, next.label)
            : null,
          project.status === 'menxia'
            ? h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--danger',
              onClick: () => patch({ status: 'zhongshu', rounds: project.rounds + 1 }),
            }, '驳回架构')
            : null,
          project.status === 'review'
            ? h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--danger',
              onClick: () => setRejecting((prev) => !prev),
            }, rejecting ? '取消打回' : '打回重做')
            : null,
          project.status === 'paused'
            ? h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--primary',
              onClick: () => patch({ status: project.pausedFrom || 'zhongshu' }),
            }, '继续（回到' + ((STATUS[project.pausedFrom] && STATUS[project.pausedFrom].label) || '架构') + '）')
            : (project.status !== 'archived'
              ? h('button', {
                type: 'button',
                className: 'dsc-btn',
                onClick: () => patch({ status: 'paused', note: '用户暂停' }),
              }, '暂停')
              : null),
          project.status === 'draft'
            ? h('button', {
              type: 'button',
              className: 'dsc-btn',
              disabled: notifyBusy,
              onClick: () => void wakeSecretary(),
            }, notifyBusy ? '叫醒中…' : '叫醒秘书接手')
            : null,
          project.departments.zhongshu.sessionId
            ? null
            : h('button', {
              type: 'button',
              className: 'dsc-btn' + (showNext ? '' : ' dsc-btn--primary'),
              onClick: async () => {
                setFlash('正在开架构会话…');
                try {
                  const result = await courtApi.handoff(project.id, 'zhongshu');
                  setFlash('已交给架构，会话 ' + result.sessionId + '；去「工位」点它的节点可以跳过去。');
                  await refresh();
                } catch (failure) {
                  setFlash('启动失败：' + (failure && failure.message ? failure.message : String(failure)));
                }
              },
            }, '启动流程（交架构）')),
          h('button', {
            type: 'button',
            className: 'dsc-btn dsc-btn--danger',
            onClick: async () => {
              const sessionIds = Object.values(project.departments || {})
                .map((dept) => dept && dept.sessionId)
                .filter(Boolean);
              const question = (sessionIds.length > 0
                ? `删除项目「${project.name}」会同时归档它关联的 ${sessionIds.length} 个会话，继续？`
                : `删除项目「${project.name}」？`)
                + '\n\n只会清理万象工阁的基线快照和验收日志；工作区代码、LLM Wiki 知识页保留。';
              const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                ? window.confirm(question)
                : true;
              if (!ok) return;
              try {
                await courtApi.remove(project.id);
                await refresh();
                if (typeof onBack === 'function') onBack();
              } catch (failure) {
                setFlash('删除失败：' + (failure && failure.message ? failure.message : String(failure)));
              }
            },
          }, '删除项目')),
        flash ? h('div', { className: 'dsc-flash' }, flash) : null,
        project.status === 'review'
          ? h('div', { className: 'dsc-note', style: { marginTop: 10 } },
            '验收通过 → 结项并通知秘书；打回 → 带着原因叫醒工程师返工。正式复核由评审做，你这里相当于最终裁决。')
          : null,
        rejecting && project.status === 'review'
          ? h('div', { className: 'dsc-card', style: { marginTop: 10 } },
            h('div', { className: 'dsc-label' }, '打回原因（写给工程师看）'),
            h('textarea', {
              className: 'dsc-textarea',
              style: { marginTop: 6 },
              value: reason,
              placeholder: '例如：首屏仍是 2.3 秒，没到 1 秒；另外改了导航结构，超出批准范围',
              onChange: (event) => setReason(event.target.value),
            }),
            h('div', { className: 'dsc-actions' },
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--danger',
                disabled: !reason.trim(),
                onClick: async () => {
                  await patch({ status: 'executing', note: reason.trim() });
                  setRejecting(false);
                  setReason('');
                },
              }, '确认打回并叫醒工程师'),
              h('button', {
                type: 'button',
                className: 'dsc-btn',
                onClick: () => setRejecting(false),
              }, '取消')))
          : null,
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '里程碑'),
            h('span', { className: 'dsc-section-hint' }, '进度 = 权重之和')),
          h('div', { className: 'dsc-card' },
            project.milestones.map((milestone) => h('button', {
              key: milestone.id,
              type: 'button',
              role: 'checkbox',
              className: 'dsc-check',
              'aria-checked': milestone.done,
              onClick: () => toggle(milestone),
            },
              h('span', { className: 'dsc-box', 'aria-hidden': true },
                milestone.done ? h(Icon, { name: 'check', size: 11 }) : null),
              h('span', { className: 'dsc-checktext' }, milestone.title),
              h('span', { className: 'dsc-weight' }, milestone.weight + '%'))))),
        h(ProjectMaterials, { project, refresh, setFlash }),
        project.deliveryDiff
          ? h('section', { className: 'dsc-section' },
            h('div', { className: 'dsc-section-head' },
              h('span', { className: 'dsc-section-title' }, '本次改动'),
              h('span', { className: 'dsc-section-hint' }, '对比开工基线，不是工程师自述')),
            h('div', { className: 'dsc-card' },
              h('div', { className: 'dsc-kv' },
                h('div', { className: 'dsc-kv-key' }, '统计'),
                h('div', { className: 'dsc-kv-val' },
                  '新增 ' + project.deliveryDiff.addedCount
                  + ' · 修改 ' + project.deliveryDiff.modifiedCount
                  + ' · 删除 ' + project.deliveryDiff.removedCount)),
              (project.deliveryDiff.added || []).length > 0
                ? h('div', { className: 'dsc-desc dsc-mono' },
                  '新增：' + project.deliveryDiff.added.join('、'))
                : null,
              (project.deliveryDiff.modified || []).length > 0
                ? h('div', { className: 'dsc-desc dsc-mono' },
                  '修改：' + project.deliveryDiff.modified.join('、'))
                : null,
              (project.deliveryDiff.removed || []).length > 0
                ? h('div', { className: 'dsc-desc dsc-mono' },
                  '删除：' + project.deliveryDiff.removed.join('、'))
                : null))
          : null,
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '工位节点'),
            h('span', { className: 'dsc-section-hint' }, project.rounds > 0 ? '驳回 ' + project.rounds + ' 轮' : '无驳回')),
          h('div', { className: 'dsc-pipe' },
            DEPTS.map((meta) => h(DeptNode, {
              key: meta.key,
              meta,
              dept: project.departments[meta.key],
              project,
              onJump,
            })))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '项目会话'),
            h('span', { className: 'dsc-section-hint' },
              sessionRows.length + ' 个 · 未结项不自动清')),
          sessionRows.length > 0
            ? sessionList
            : h('div', { className: 'dsc-note' }, '还没有会话。交一次架构或工程师就会创建。')),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '工作区'),
            h('span', { className: 'dsc-section-hint' }, '项目管理定')),
          h('div', { className: 'dsc-card' },
            h('div', { className: 'dsc-kv' },
              h('div', { className: 'dsc-kv-key' }, '路径'),
              h('div', { className: 'dsc-kv-val dsc-mono' },
                project.workspace && project.workspace.path ? project.workspace.path : '未指定')),
            h('div', { className: 'dsc-kv', style: { marginTop: 6 } },
              h('div', { className: 'dsc-kv-key' }, '创建'),
              h('div', { className: 'dsc-kv-val' }, timeAgo(project.createdAt))),
            project.baseline
              ? h('div', { className: 'dsc-kv', style: { marginTop: 6 } },
                h('div', { className: 'dsc-kv-key' }, '基线'),
                h('div', { className: 'dsc-kv-val' },
                  project.baseline.count + ' 个文件'
                  + (project.baseline.commit ? ' · commit ' + project.baseline.commit : '')))
              : null,
            h('div', { className: 'dsc-note', style: { marginTop: 6 } },
              '后续架构师/评审/项目经理/工程师优先使用这个目录；已有会话可能仍在旧工作区，见上方「项目会话」。'))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '工单'),
            h('span', { className: 'dsc-section-hint' },
              (project.packages || []).length > 0
                ? packageSummary(project)
                : '没拆工单（轻量编制可以只有契约）')),
          (project.packages || []).length > 0
            ? h('div', { className: 'dsc-card' },
              h('div', { className: 'dsc-list' },
                project.packages.map((item) => h('div', { key: item.id, className: 'dsc-kv' },
                  h('div', { className: 'dsc-kv-key' },
                    h('span', { className: 'dsc-badge dsc-tone-' + packageTone(item.state) },
                      packageStateLabel(item.state)),
                    ' ',
                    h('span', { className: 'dsc-mono' }, item.id)),
                  h('div', { className: 'dsc-kv-val' },
                    h('div', null, item.title || '(未命名工单)'),
                    (item.files || []).length > 0
                      ? h('div', { className: 'dsc-note dsc-mono' }, '只许改：' + item.files.join('、'))
                      : h('div', { className: 'dsc-note' }, '没声明文件归属：并行时容易被别人改到'),
                    (item.dependsOn || []).length > 0
                      ? h('div', { className: 'dsc-note' }, '依赖：' + item.dependsOn.join('、'))
                      : null,
                    item.note ? h('div', { className: 'dsc-note' }, item.note) : null)))))
            : h('div', { className: 'dsc-card' },
              h('div', { className: 'dsc-note' },
                '项目经理可以用 court_set_packages 把契约拆成工单：每张写清「只许改哪些文件」和「完成标准」，'
                + '互相重叠又不排先后的会被直接拒绝。'))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '上下文与归属'),
            h('span', { className: 'dsc-section-hint' },
              (project.ownership || []).length + ' 条归属 · '
              + (contextFilled(project) ? '已登记结构' : '未登记结构'))),
          h('div', { className: 'dsc-card' },
            contextFilled(project)
              ? h('div', { className: 'dsc-list' },
                contextRows(project).map((row) => h('div', { key: row.key, className: 'dsc-kv' },
                  h('div', { className: 'dsc-kv-key' }, row.label),
                  h('div', { className: 'dsc-kv-val' },
                    h('div', { className: 'dsc-note', style: { whiteSpace: 'pre-wrap' } }, row.value)))))
              : h('div', { className: 'dsc-note' },
                '还没有登记项目结构。架构师可以用 court_set_context 写清「入口/技术栈/约定/坑」，'
                + '这些会随每次移交带给下一个人，省掉重新摸底。'),
            (project.ownership || []).length > 0
              ? h('div', { style: { marginTop: 10 } },
                h('div', { className: 'dsc-note' }, '文件归属（工单之外的声明式范围）：'),
                h('div', { className: 'dsc-mono dsc-note', style: { whiteSpace: 'pre-wrap' } },
                  project.ownership.join('\n')))
              : null)),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '时间盒'),
            h('span', { className: 'dsc-section-hint' },
              project.appetiteView
                ? '已用 ' + project.appetiteView.usedHours + ' / ' + project.appetiteView.hours + ' 小时'
                  + (project.appetiteView.extensions ? ' · 延期 ' + project.appetiteView.extensions.length + ' 次' : '')
                : '未设定')),
          h('div', { className: 'dsc-card' },
            h('div', { className: project.appetiteView && project.appetiteView.over ? 'dsc-note dsc-tone-danger' : 'dsc-note' },
              project.appetiteText
                || '还没定时间盒。定一个（court_set_appetite）的好处是：到点只有三个选项——砍范围、延期、结项，'
                  + '而不是无限做下去。'))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '用户操作单'),
            h('span', { className: 'dsc-section-hint' },
              manualHint(project))),
          h('div', { className: 'dsc-card' },
            (project.manual || []).length > 0
              ? h('div', { className: 'dsc-list' },
                project.manual.map((item) => h('div', { key: item.id, className: 'dsc-kv' },
                  h('div', { className: 'dsc-kv-key' },
                    h('span', { className: item.status === 'done' ? 'dsc-tone-ok' : 'dsc-tone-warn' },
                      item.status === 'done' ? '✓ ' : '○ '),
                    item.title),
                  h('div', { className: 'dsc-kv-val' },
                    item.detail ? h('div', { className: 'dsc-note', style: { whiteSpace: 'pre-wrap' } }, item.detail) : null,
                    item.status === 'done'
                      ? h('div', { className: 'dsc-note dsc-tone-ok' },
                        '已确认' + (item.confirmedBy ? '（' + item.confirmedBy.slice(0, 12) + '）' : ''))
                      : h('div', { className: 'dsc-note' }, '只有你能做；做完告诉秘书，由秘书勾掉'),
                    item.note ? h('div', { className: 'dsc-note' }, item.note) : null))))
              : h('div', { className: 'dsc-note' },
                '没有需要你亲手做的事。要配环境变量、去后台点按钮、真机扫码这类，'
                + '由项目经理用 court_set_manual 列进来——工程师不能替你勾完成。'))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '报价与记账'),
            h('span', { className: 'dsc-section-hint' },
              project.quote ? '已报价' : '未报价')),
          h('div', { className: 'dsc-card' },
            project.quote
              ? h('div', { className: 'dsc-list' },
                h('div', { className: 'dsc-kv' },
                  h('div', { className: 'dsc-kv-key' }, '预算'),
                  h('div', { className: 'dsc-kv-val' },
                    (project.quote.rounds || '-') + ' 轮返工 · '
                    + (project.quote.tokenBudget
                      ? Math.round(project.quote.tokenBudget / 1000) + 'K token'
                      : '未设 token 预算'))),
                h('div', { className: 'dsc-kv' },
                  h('div', { className: 'dsc-kv-key' }, '实际'),
                  h('div', { className: 'dsc-kv-val' },
                    ((project.actual && project.actual.rounds) || 0) + ' 轮返工 · '
                    + ((project.actual && project.actual.verifications) || 0) + ' 次验收',
                    project.quote.rounds && project.actual && project.actual.rounds > project.quote.rounds
                      ? h('span', { className: 'dsc-tone-danger' }, ' ⚠ 已超报价')
                      : null)),
                project.quote.note ? h('div', { className: 'dsc-note' }, project.quote.note) : null)
              : h('div', { className: 'dsc-note' },
                '还没有报价。派活前用 court_set_quote 写下「打算花几轮、多少 token」，'
                + '返工与验收会自动记账，超了会在这里标红。'))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '验收'),
            h('span', { className: 'dsc-section-hint' },
              (project.checks || []).length + ' 条命令')),
          h('div', { className: 'dsc-card' },
            (project.checks || []).length > 0
              ? h('div', { className: 'dsc-list' },
                project.checks.map((check) => h('div', { key: check.id, className: 'dsc-kv' },
                  h('div', { className: 'dsc-kv-key dsc-mono' }, check.id),
                  h('div', { className: 'dsc-kv-val dsc-mono' }, check.command))))
              : h('div', { className: 'dsc-note' }, '还没有登记验收命令：方案阶段用 court_set_checks 补 test/lint/build。'),
            (() => {
              const last = (project.verifications || []).slice(-1)[0];
              if (!last) return null;
              return h('div', { style: { marginTop: 10 } },
                h('div', { className: 'dsc-note' },
                  '最近验证：' + (last.ok ? '通过' : '未通过') + ' · ' + timeAgo(last.at)
                  + (last.id ? ' · ' + last.id : '')),
                (last.checks || []).length > 0
                  ? h('div', { className: 'dsc-list', style: { marginTop: 6 } },
                    last.checks.map((check) => h('div', {
                      key: check.id,
                      className: 'dsc-kv',
                    },
                    h('div', { className: 'dsc-kv-key dsc-mono' }, check.id),
                    h('div', { className: 'dsc-kv-val dsc-mono' },
                      (check.ok ? 'PASS' : 'FAIL') + ' · exit ' + check.exitCode
                      + ' · ' + check.durationMs + 'ms'))))
                  : null);
            })())),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '自动化'),
            h('span', { className: 'dsc-section-hint' }, '全自动 = 不问你问题')),
          h('div', { className: 'dsc-card' },
            h('div', { className: 'dsc-row' },
              h('div', { className: 'dsc-desc', style: { marginTop: 0 } },
                '全自动推进',
                h('div', { className: 'dsc-note', style: { marginTop: 2 } },
                  project.autoMode
                    ? '已开启：工位不会提问，自己拍板并把假设写进文书'
                    : '默认关闭：要你拍板的事会挂到「奏疏」等你批复')),
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--sm' + (project.autoMode ? ' dsc-btn--primary' : ''),
                onClick: () => patch({ autoMode: !project.autoMode }),
              }, project.autoMode ? '全自动' : '手动')))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '知识库'),
            h('span', { className: 'dsc-section-hint' }, '可选项')),
          h('div', { className: 'dsc-card' },
            h('div', { className: 'dsc-row' },
              h('div', { className: 'dsc-desc', style: { marginTop: 0 } },
                '允许本项目的 AI 浏览知识库',
                h('div', { className: 'dsc-note', style: { marginTop: 2 } },
                  project.vaultAccess
                    ? '已开启：工位可以用 court_vault_search 只读检索你的知识库'
                    : '当前关闭：打开后工位才能检索知识库')),
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--sm' + (project.vaultAccess ? ' dsc-btn--primary' : ''),
                onClick: () => patch({ vaultAccess: !project.vaultAccess }),
              }, project.vaultAccess ? '已开启' : '已关闭')),
            (project.status === 'done' || project.status === 'archived' || project.progress >= 100)
              ? h('div', { style: { marginTop: 10 } },
                h('div', { className: 'dsc-note' },
                  project.vaultEntry
                    ? '这个项目已经收进过知识库；可以再次写入最新复盘。'
                    : '项目已结项。把这次做法的经验写进知识库？'),
                h('div', { className: 'dsc-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dsc-btn dsc-btn--primary dsc-btn--sm',
                    disabled: vaultBusy,
                    onClick: intakeVault,
                  }, vaultBusy ? '写入中…' : (project.vaultEntry ? '再次写入知识库' : '收进知识库'))))
              : null,
            project.vaultEntry
              ? h('div', { className: 'dsc-kv', style: { marginTop: 8 } },
                h('div', { className: 'dsc-kv-key' }, '已投递'),
                h('div', { className: 'dsc-kv-val dsc-mono' }, project.vaultEntry.path))
              : null,
            project.vaultEntry
              ? h('div', { className: 'dsc-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--sm',
                  disabled: vaultBusy,
                  onClick: () => void checkVault(),
                }, vaultBusy ? '检查中…' : '检查 LLM Wiki 导入'),
                vaultImport
                  ? h('span', { className: 'dsc-note', style: { alignSelf: 'center' } },
                    vaultImport.done
                      ? `已导入 ${vaultImport.importedCount} 页 · ` + (vaultImport.imported[0] ? vaultImport.imported[0].rel : '')
                      : 'raw 已投递，等待 LLM Wiki 导入')
                  : null)
              : null,
            vaultMessage ? h('div', { className: 'dsc-flash' }, vaultMessage) : null)),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '文书'),
            h('span', { className: 'dsc-section-hint' }, (project.briefs || []).length + ' 份')),
          (project.briefs || []).length > 0
            ? h('div', { className: 'dsc-list' },
              project.briefs.map((brief) => h('div', { key: brief.id, className: 'dsc-card' },
                h('div', { className: 'dsc-row' },
                  h('div', { className: 'dsc-rowmain' },
                    h('span', { className: 'dsc-badge dsc-tone-neutral' }, kindLabel(brief.kind)),
                    h('span', { className: 'dsc-name' }, brief.title || '未命名文书'),
                    kindOverBudget(brief)
                      ? h('span', { className: 'dsc-badge dsc-tone-danger' }, '超预算')
                      : null,
                    h('span', { className: 'dsc-meta' },
                      (brief.chars || (brief.content || '').length) + ' 字'
                      + (KIND_BUDGET[brief.kind] ? ' / ' + KIND_BUDGET[brief.kind] : ''))),
                  h('span', { className: 'dsc-meta' }, timeAgo(brief.createdAt))),
                h('div', { className: 'dsc-desc' }, brief.summary || brief.content || ''))))
            : h(Empty, null, '还没有文书。架构师把方案写进 court_save_brief 之后，这里就会出现。')));
    }

    const ROLE_CN = { zhongshu: '架构师', menxia: '评审', shangshu: '项目经理', executor: '工程师', secretary: '接单台' };

    function PetitionsView({ data, refresh, onBack }) {
      const [drafts, setDrafts] = React.useState({});
      const [busy, setBusy] = React.useState(null);
      const [message, setMessage] = React.useState(null);

      const open = [];
      const blocked = [];
      for (const project of (data && data.projects) || []) {
        const hasOpen = (project.questions || []).some((question) => question.status === 'open');
        for (const question of project.questions || []) {
          if (question.status === 'open') open.push({ project, question });
        }
        if (project.status === 'blocked' && !hasOpen) blocked.push(project);
      }

      const unblock = async (project) => {
        setBusy(project.id);
        try {
          await courtApi.patch(project.id, {
            status: project.statusBeforeBlocked || 'zhongshu',
            blockedReason: null,
            note: '用户在奏疏页解除阻塞',
          });
          setMessage('已解除阻塞：' + project.name);
          await refresh();
        } catch (failure) {
          setMessage('解除失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setBusy(null);
        }
      };

      const send = async (project, question) => {
        const text = (drafts[question.id] || '').trim();
        if (!text) return;
        setBusy(question.id);
        try {
          await courtApi.answer(project.id, question.id, text);
          setMessage('已答复，' + (ROLE_CN[question.by] || question.by) + '已被叫醒继续。');
          await refresh();
        } catch (failure) {
          setMessage('答复失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setBusy(null);
        }
      };

      return h('div', null,
        h('div', { className: 'dsc-row', style: { marginTop: 16 } },
          h('button', { type: 'button', className: 'dsc-btn dsc-btn--sm', onClick: onBack }, '← 返回项目库'),
          h('span', { className: 'dsc-section-hint' },
            open.length + blocked.length + ' 条待处理')),
        message ? h('div', { className: 'dsc-flash' }, message) : null,
        open.length + blocked.length === 0
          ? h('div', { style: { marginTop: 16 } }, h(Empty, null, '没有待批的奏疏，也没有阻塞项目。'))
          : h('div', { className: 'dsc-list', style: { marginTop: 16 } },
            blocked.map((project) => h('div', { key: 'blocked-' + project.id, className: 'dsc-card' },
              h('div', { className: 'dsc-row' },
                h('div', { className: 'dsc-rowmain' },
                  h('span', { className: 'dsc-badge dsc-tone-danger' }, '阻塞'),
                  h('span', { className: 'dsc-name' }, project.name)),
                h('span', { className: 'dsc-meta' }, timeAgo(project.updatedAt))),
              h('div', { className: 'dsc-desc' }, project.blockedReason || '项目被阻塞，没有挂起的问题。'),
              h('div', { className: 'dsc-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--primary dsc-btn--sm',
                  disabled: busy === project.id,
                  onClick: () => void unblock(project),
                }, busy === project.id ? '解除中…' : '解除阻塞')))),
            open.map(({ project, question }) => h('div', { key: question.id, className: 'dsc-card' },
              h('div', { className: 'dsc-row' },
                h('div', { className: 'dsc-rowmain' },
                  h('span', { className: 'dsc-badge dsc-tone-warn' }, ROLE_CN[question.by] || question.by),
                  h('span', { className: 'dsc-name' }, project.name)),
                h('span', { className: 'dsc-meta' }, timeAgo(question.at))),
              h('div', { className: 'dsc-desc' }, question.question),
              question.context ? h('div', { className: 'dsc-note' }, question.context) : null,
              (question.options || []).length > 0
                ? h('div', { className: 'dsc-actions' },
                  question.options.map((option) => h('button', {
                    key: option,
                    type: 'button',
                    className: 'dsc-btn dsc-btn--sm',
                    onClick: () => {
                      setDrafts((prev) => ({ ...prev, [question.id]: option }));
                    },
                  }, option)))
                : null,
              h('textarea', {
                className: 'dsc-textarea',
                style: { marginTop: 8 },
                value: drafts[question.id] || '',
                placeholder: '在这里回答…',
                onChange: (event) => setDrafts((prev) => ({ ...prev, [question.id]: event.target.value })),
              }),
              h('div', { className: 'dsc-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--primary dsc-btn--sm',
                  disabled: busy === question.id || !(drafts[question.id] || '').trim(),
                  onClick: () => void send(project, question),
                }, busy === question.id ? '提交中…' : '批复并继续'))))));
    }

    // 公司总览：一行一个项目，只回答「现在谁在干什么、卡在谁那儿」。
    function portfolioRows(data) {
      if (data && Array.isArray(data.portfolio) && data.portfolio.length) return data.portfolio;
      const projects = (data && data.projects) || [];
      return projects.map((project) => ({
        id: project.id,
        name: project.name,
        shape: project.shape || project.mode,
        status: project.status,
        progress: project.progress,
        health: project.health,
        appetite: project.appetiteView,
        packagesDoing: (project.packages || []).filter((pkg) => pkg.state === 'doing' || pkg.state === 'ready').length,
        manualPending: (project.manual || []).filter((item) => item.status !== 'done').length,
        questionsOpen: (project.questions || []).filter((item) => !item.answer).length,
        rounds: project.rounds,
        updatedAt: project.updatedAt,
      }));
    }

    function needsAttention(row) {
      return Boolean(
        (row.appetite && row.appetite.over)
        || row.manualPending > 0
        || row.questionsOpen > 0
        || row.status === 'blocked'
        || (row.health && row.health.level === 'bad'),
      );
    }

    function PortfolioStrip({ data, onOpen }) {
      const rows = portfolioRows(data);
      if (rows.length === 0) return null;
      const live = rows.filter((row) => !['draft', 'done', 'archived', 'paused'].includes(row.status));
      const wip = rows.reduce((sum, row) => sum + (row.packagesDoing || 0), 0);
      const over = rows.filter((row) => row.appetite && row.appetite.over).length;
      const attention = rows.filter(needsAttention);
      return h('div', { style: { marginTop: 16 } },
        h('div', { className: 'dsc-stats' },
          h(Stat, { value: rows.length, label: '项目' }),
          h(Stat, { value: live.length, label: '在推进' }),
          h(Stat, { value: wip, label: '工单在制' }),
          h(Stat, { value: over > 0 ? over : attention.length, label: over > 0 ? '超时间盒' : '等你处理' })),
        attention.length > 0
          ? h('div', { className: 'dsc-list', style: { marginTop: 12 } },
            attention.map((row) => h('div', {
              key: row.id,
              className: 'dsc-card' + (onOpen ? ' dsc-card--click' : ''),
              role: onOpen ? 'button' : undefined,
              tabIndex: onOpen ? 0 : undefined,
              onClick: onOpen ? () => onOpen(row.id) : undefined,
            },
              h('div', { className: 'dsc-row' },
                h('div', { className: 'dsc-rowmain' },
                  h(Badge, { status: row.status }),
                  h('span', { className: 'dsc-name' }, row.name),
                  h('span', { className: 'dsc-meta' }, shapeShort(row))),
                h(Progress, { value: row.progress })),
              h('div', { className: 'dsc-meta' },
                row.health && row.health.label
                  ? h('span', {
                    className: 'dsc-tone-' + (row.health.level === 'bad' ? 'danger' : row.health.level === 'warn' ? 'warn' : 'ok'),
                  }, row.health.label)
                  : null,
                row.appetite
                  ? h('span', { className: row.appetite.over ? 'dsc-tone-danger' : undefined },
                    '时间盒 ' + row.appetite.hours + 'h · 已用 ' + row.appetite.usedHours + 'h')
                  : null,
                row.packagesDoing > 0 ? h('span', null, '工单在制 ' + row.packagesDoing) : null,
                row.manualPending > 0 ? h('span', { className: 'dsc-tone-warn' }, '客户待办 ' + row.manualPending) : null,
                row.questionsOpen > 0 ? h('span', { className: 'dsc-tone-warn' }, '待你批复 ' + row.questionsOpen) : null,
                h('span', null, '更新 ' + timeAgo(row.updatedAt))))))
          : null);
    }

    function HallView({ data, error, refresh, jump, focusId, focusMode }) {
      const [view, setView] = React.useState({ kind: 'list' });
      const [creating, setCreating] = React.useState(false);
      const [flash, setFlash] = React.useState(null);
      const projects = (data && data.projects) || [];
      const current = view.kind === 'detail' ? projects.find((p) => p.id === view.id) : null;
      const openCount = projects.reduce(
        (sum, project) => sum + (project.questions || []).filter((q) => q.status === 'open').length,
        0,
      );
      const blockedCount = projects.filter((project) => (
        project.status === 'blocked'
        && !(project.questions || []).some((question) => question.status === 'open')
      )).length;
      const petitionCount = openCount + blockedCount;

      React.useEffect(() => {
        if (focusMode === 'create') {
          setView({ kind: 'list' });
          setCreating(true);
        } else if (focusMode === 'petitions') {
          setCreating(false);
          setView({ kind: 'petitions' });
        } else if (focusId) {
          setCreating(false);
          setView({ kind: 'detail', id: focusId });
        } else {
          setCreating(false);
          setView({ kind: 'list' });
        }
      }, [focusId, focusMode]);

      const onJump = (sessionId) => {
        if (typeof jump === 'function' && jump(sessionId)) return true;
        return false;
      };

      return h('div', null,
        h(ErrorNote, { message: error }),
        flash
          ? h('div', { className: 'dsc-flash' + (flash.tone === 'ok' ? ' dsc-flash--ok' : flash.tone === 'warn' ? ' dsc-flash--warn' : '') },
            h('span', null, flash.text))
          : null,
        current
          ? h(ProjectDetail, {
            project: current,
            refresh,
            onJump,
            onBack: () => setView({ kind: 'list' }),
          })
          : view.kind === 'petitions'
            ? h(PetitionsView, { data, refresh, onBack: () => setView({ kind: 'list' }) })
            : h('div', null,
            h('div', { className: 'dsc-row', style: { marginTop: 16 } },
              h('span', { className: 'dsc-section-hint' }, projects.length + ' 个项目'),
              h('div', { className: 'dsc-actions', style: { marginTop: 0 } },
                h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--sm' + (petitionCount > 0 ? ' dsc-btn--danger' : ''),
                  onClick: () => setView({ kind: 'petitions' }),
                }, '奏疏' + (petitionCount > 0 ? '（' + petitionCount + '）' : '')),
                h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--primary dsc-btn--sm',
                  onClick: () => setCreating((prev) => !prev),
                }, creating ? '收起' : '新建项目'))),
            creating
              ? h(CreateForm, {
                onCreated: async (result) => {
                  await refresh();
                  const ok = Boolean(result && result.secretary && result.secretary.sessionId);
                  setFlash(ok
                    ? { tone: 'ok', text: '「' + result.project.name + '」已立项，接单台已收到。' }
                    : {
                      tone: 'warn',
                      text: '「' + (result && result.project ? result.project.name : '项目')
                        + '」已立项，但接单台没被叫醒；可点「再叫一次秘书」。',
                    });
                },
                onCancel: () => setCreating(false),
                onOpenSession: (sessionId) => {
                  if (onJump(sessionId)) return true;
                  return false;
                },
              })
              : null,
            h(PortfolioStrip, { data, onOpen: (id) => setView({ kind: 'detail', id }) }),
            projects.length === 0
              ? h('div', { style: { marginTop: 16 } },
                h(Empty, null,
                  '项目库是空的。',
                  h('div', { style: { marginTop: 6 } }, '点「新建项目」先立一个；之后在秘书会话里说一句也行。')))
              : h('div', { className: 'dsc-list', style: { marginTop: 16 } },
                projects.map((project) => h(ProjectRow, {
                  key: project.id,
                  project,
                  onClick: () => setView({ kind: 'detail', id: project.id }),
                })))));
    }

    const KB_KIND_LABELS = {
      decision: '决策',
      constraint: '约定',
      pitfall: '坑',
      pattern: '做法',
      tool: '工具',
      glossary: '术语',
      client: '客户偏好',
    };

    const KB_TONE = {
      decision: 'info',
      constraint: 'warn',
      pitfall: 'danger',
      pattern: 'ok',
      tool: 'neutral',
      glossary: 'muted',
      client: 'active',
    };

    /**
     * 知识库：企业级智库。
     *
     * 这里放的是「公司记住了什么」——决策、约定、坑、做法、工具、术语、客户偏好。
     * 和 vault 的分工：vault 是往外交付的产物，kb 是内部记忆，会在每次移交时
     * 挑 3 条注入到目标岗位的提示词里（见 context.js 的 kbBlock）。
     */
    function ScriptoriumView({ data, error, refresh }) {
      const items = (data && data.vault) || [];
      const projects = (data && data.projects) || [];
      const vaultPath = (data && data.settings && data.settings.vaultPath) || '';
      const [draft, setDraft] = React.useState(vaultPath);
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);

      const [query, setQuery] = React.useState('');
      const [kind, setKind] = React.useState('');
      const [payload, setPayload] = React.useState(null);
      const [kbError, setKbError] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [openId, setOpenId] = React.useState(null);
      const [kbTall, setKbTall] = React.useState(false);

      const [digestProject, setDigestProject] = React.useState('');
      const [candidates, setCandidates] = React.useState(null);
      const [picked, setPicked] = React.useState({});
      const [digestBusy, setDigestBusy] = React.useState(false);

      React.useEffect(() => setDraft(vaultPath), [vaultPath]);

      const loadKb = React.useCallback(async (nextQuery, nextKind) => {
        setLoading(true);
        setKbError(null);
        try {
          const result = await courtApi.kb({ q: nextQuery, kind: nextKind, limit: 60 });
          setPayload(result);
        } catch (failure) {
          setKbError(failure && failure.message ? failure.message : String(failure));
        } finally {
          setLoading(false);
        }
      }, []);

      React.useEffect(() => { void loadKb(query, kind); }, [loadKb, query, kind]);

      const stats = (payload && payload.stats) || { total: 0, pinned: 0, byKind: {} };
      const kinds = (payload && payload.kinds) || [];
      const hits = (payload && payload.hits) || [];

      const save = async () => {
        if (!draft.trim() || busy) return;
        setBusy(true);
        setMessage(null);
        try {
          const result = await courtApi.setVaultPath(draft.trim());
          setMessage('已设置：' + (result.settings && result.settings.vaultPath ? result.settings.vaultPath : draft.trim()));
          await refresh();
        } catch (failure) {
          setMessage('设置失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setBusy(false);
        }
      };

      const flash = (text) => setMessage(text);

      const togglePin = async (entry) => {
        try {
          await courtApi.kbUpdate({ id: entry.id, pinned: !entry.pinned });
          await loadKb(query, kind);
        } catch (failure) {
          setKbError(failure && failure.message ? failure.message : String(failure));
        }
      };

      const removeEntry = async (entry) => {
        try {
          await courtApi.kbUpdate({ id: entry.id, remove: true });
          await loadKb(query, kind);
        } catch (failure) {
          setKbError(failure && failure.message ? failure.message : String(failure));
        }
      };

      const runDigest = async () => {
        if (!digestProject || digestBusy) return;
        setDigestBusy(true);
        setKbError(null);
        try {
          const result = await courtApi.kbDigest(digestProject);
          const list = (result && result.candidates) || [];
          const next = {};
          list.forEach((entry, index) => { next[index] = true; });
          setCandidates(list);
          setPicked(next);
          if (list.length === 0) flash('这个项目没有可提炼的内容：先让架构师写 court_set_context，或让工程师交一份交付说明。');
        } catch (failure) {
          setKbError(failure && failure.message ? failure.message : String(failure));
        } finally {
          setDigestBusy(false);
        }
      };

      const saveDigest = async () => {
        if (!candidates || digestBusy) return;
        setDigestBusy(true);
        setKbError(null);
        try {
          let saved = 0;
          for (let index = 0; index < candidates.length; index += 1) {
            if (!picked[index]) continue;
            const entry = candidates[index];
            await courtApi.kbSave({
              kind: entry.kind,
              title: entry.title,
              body: entry.body,
              tags: entry.tags,
              projectId: entry.projectId,
            });
            saved += 1;
          }
          setCandidates(null);
          setPicked({});
          await loadKb(query, kind);
          flash('已从项目提炼 ' + saved + ' 条进智库');
        } catch (failure) {
          setKbError(failure && failure.message ? failure.message : String(failure));
        } finally {
          setDigestBusy(false);
        }
      };

      return h('div', null,
        h(ErrorNote, { message: error }),
        h(ErrorNote, { message: kbError }),
        h('div', { className: 'dsc-stats' },
          h(Stat, { value: stats.total, label: '智库条目' }),
          h(Stat, { value: stats.pinned, label: '铁律（置顶）' }),
          h(Stat, { value: hits.length, label: '当前命中' })),

        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '公司记忆'),
            h('span', { className: 'dsc-section-hint' }, '移交时自动挑 3 条注入给下一个岗位'),
            hits.length > 0
              ? h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--sm',
                onClick: () => setKbTall(!kbTall),
              }, kbTall ? '收起列表' : '放大列表')
              : null),
          h('div', { className: 'dsc-toolbar' },
            h('input', {
              className: 'dsc-input dsc-mono',
              value: query,
              placeholder: '搜标题 / 正文 / 标签，例如「GBK」「小程序」「支付」',
              onChange: (event) => setQuery(event.target.value),
            })),
          h('div', { className: 'dsc-chips' },
            h('button', {
              type: 'button',
              className: 'dsc-chip' + (kind === '' ? ' dsc-chip--on' : ''),
              onClick: () => setKind(''),
            }, '全部'),
            kinds.map((item) => h('button', {
              key: item.key,
              type: 'button',
              className: 'dsc-chip' + (kind === item.key ? ' dsc-chip--on' : ''),
              onClick: () => setKind(kind === item.key ? '' : item.key),
            }, item.label))),
          message ? h('div', { className: 'dsc-flash' }, message) : null,
          loading && hits.length === 0
            ? h('div', { className: 'dsc-note' }, '读取中…')
            : hits.length === 0
              ? h(Empty, null,
                stats.total === 0 ? '智库还是空的。' : '没有命中。',
                h('div', { style: { marginTop: 6 } },
                  stats.total === 0
                    ? '两种攒法：让岗位在干活时用 court_kb_save 记一条；或在下面「从项目提炼」里一次性收走结论。'
                    : '换个词试试；中文检索走二元组，别写整句。'))
              : h('div', { className: 'dsc-kbroll' + (kbTall ? ' dsc-kbroll--tall' : '') },
                h('div', { className: 'dsc-list' },
                hits.map((entry) => {
                  const open = openId === entry.id;
                  return h('div', { key: entry.id, className: 'dsc-card' },
                    h('div', { className: 'dsc-row' },
                      h('div', { className: 'dsc-rowmain' },
                        h('span', { className: 'dsc-badge dsc-tone-' + (KB_TONE[entry.kind] || 'neutral') },
                          entry.pinned ? '★ 铁律' : (KB_KIND_LABELS[entry.kind] || entry.kind)),
                        h('span', {
                          className: 'dsc-name',
                          style: { cursor: 'pointer' },
                          onClick: () => setOpenId(open ? null : entry.id),
                        }, entry.title)),
                      h('span', { className: 'dsc-meta' },
                        (entry.from ? entry.from + ' · ' : '') + timeAgo(entry.updatedAt))),
                    h('div', { className: 'dsc-desc' + (open ? '' : ' dsc-clamp2') },
                      open ? entry.body : String(entry.body || '').replace(/\s+/g, ' ').slice(0, 160)),
                    h('div', { className: 'dsc-kbtags' },
                      (entry.tags || []).map((tag) => h('span', { key: tag, className: 'dsc-kbtag' }, tag)),
                      entry.confidence >= 3 ? h('span', { className: 'dsc-kbtag' }, '已验证') : null),
                    h('div', { className: 'dsc-actions' },
                      h('button', {
                        type: 'button',
                        className: 'dsc-btn dsc-btn--sm',
                        onClick: () => void togglePin(entry),
                      }, entry.pinned ? '取消置顶' : '置顶'),
                      h('button', {
                        type: 'button',
                        className: 'dsc-btn dsc-btn--sm',
                        onClick: () => setOpenId(open ? null : entry.id),
                      }, open ? '收起' : '展开'),
                      h('button', {
                        type: 'button',
                        className: 'dsc-btn dsc-btn--sm dsc-btn--danger',
                        onClick: () => void removeEntry(entry),
                      }, '删除')));
                })))),

        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '从项目提炼'),
            h('span', { className: 'dsc-section-hint' }, '把这一次的经验变成下一次的起点')),
          h('div', { className: 'dsc-toolbar' },
            h('select', {
              className: 'dsc-input',
              value: digestProject,
              onChange: (event) => { setDigestProject(event.target.value); setCandidates(null); },
            },
            h('option', { value: '' }, '选一个项目…'),
            projects.map((project) => h('option', { key: project.id, value: project.id },
              project.name + '（' + (project.shape || 'crew') + '）'))),
            h('button', {
              type: 'button',
              className: 'dsc-btn dsc-btn--sm dsc-btn--primary',
              disabled: !digestProject || digestBusy,
              onClick: () => void runDigest(),
            }, digestBusy ? '提炼中…' : '提炼候选')),
          h('div', { className: 'dsc-note', style: { marginTop: 6 } },
            '候选来自项目上下文（技术栈 / 约定 / 坑）与交付类文书的结论行；提炼只读不写，勾选后才会进库。'),
          candidates
            ? h('div', { style: { marginTop: 10 } },
              candidates.length === 0
                ? h('div', { className: 'dsc-note' }, '没有候选。')
                : h('div', { className: 'dsc-list' },
                  candidates.map((entry, index) => h('label', {
                    key: String(index),
                    className: 'dsc-card dsc-card--click',
                  },
                  h('div', { className: 'dsc-row' },
                    h('div', { className: 'dsc-rowmain' },
                      h('input', {
                        type: 'checkbox',
                        className: 'dsc-check',
                        checked: Boolean(picked[index]),
                        onChange: (event) => setPicked(Object.assign({}, picked, { [index]: event.target.checked })),
                      }),
                      h('span', { className: 'dsc-badge dsc-tone-' + (KB_TONE[entry.kind] || 'neutral') },
                        KB_KIND_LABELS[entry.kind] || entry.kind),
                      h('span', { className: 'dsc-name' }, entry.title))),
                  h('div', { className: 'dsc-desc' }, String(entry.body || '').slice(0, 200))))),
              h('div', { className: 'dsc-actions', style: { marginTop: 10 } },
                h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--sm dsc-btn--primary',
                  disabled: digestBusy,
                  onClick: () => void saveDigest(),
                }, digestBusy ? '写入中…' : '存进智库'),
                h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--sm',
                  onClick: () => { setCandidates(null); setPicked({}); },
                }, '清空')))
            : null),

        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '交付出口（LLM Wiki）'),
            h('span', { className: 'dsc-section-hint' }, 'LLM Wiki 根目录')),
          h('div', { className: 'dsc-card' },
            h('div', { className: 'dsc-field' },
              h('label', { className: 'dsc-label' }, 'Wiki 根目录（含 schema.md 与 wiki/）'),
              h('input', {
                className: 'dsc-input dsc-mono',
                value: draft,
                placeholder: '/path/to/your-wiki（例如 D:\\notes\\knowledge）',
                onChange: (event) => setDraft(event.target.value),
              }),
              h('div', { className: 'dsc-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--primary dsc-btn--sm',
                  disabled: busy || !draft.trim(),
                  onClick: () => void save(),
                }, busy ? '检查中…' : '保存路径'))),
            vaultPath
              ? null
              : h('div', { className: 'dsc-note dsc-tone-warn', style: { marginTop: 6 } },
                '还没设交付出口：不填也能用，但项目结项时不会把复盘写进知识库。'),
            h('div', { className: 'dsc-note', style: { marginTop: 6 } },
              '收进知识库时写的是 raw/sources/dsh-court/，由 LLM Wiki 的 source watcher 导入成「来源 / 概念 / 实体」页；' +
              '不直接写 wiki/，因为 LLM Wiki 不会索引外部直写的 wiki 文件。'))),
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '已交付条目'),
            h('span', { className: 'dsc-section-hint' }, '来自项目结项')),
          items.length === 0
            ? h('div', { className: 'dsc-note' }, '还没有交付过项目复盘。')
            : h('div', { className: 'dsc-list' },
              items.map((item) => h('div', { key: item.id, className: 'dsc-card' },
                h('div', { className: 'dsc-row' },
                  h('div', { className: 'dsc-rowmain' },
                    h('span', { className: 'dsc-badge dsc-tone-' + (item.syncedAt ? 'ok' : 'neutral') },
                      item.syncedAt ? '已入库' : '待同步'),
                    h('span', { className: 'dsc-name' }, item.title || '未命名')),
                  h('span', { className: 'dsc-meta' }, timeAgo(item.savedAt))),
                h('div', { className: 'dsc-desc dsc-mono' }, item.root || item.path || item.preview || ''))))));
    }

    // ---------------------------------------------------------------------
    // 接单台快捷入口：点击进入（没有就建），长按向右滑动换一个新的
    // ---------------------------------------------------------------------

    const SECRETARY_HOLD_MS = 420;
    const SECRETARY_SWIPE_PX = 56;

    /**
     * 模块级跳转。侧栏底部的动作拿不到插槽注入的 `jump`，这里用同一份
     * uiWorkspace 实现，保证两个入口行为一致。
     */
    function jumpToSession(sessionId) {
      if (!sessionId) return false;
      let workspace;
      try {
        workspace = clientCtx && typeof clientCtx.get === 'function' ? clientCtx.get('uiWorkspace') : undefined;
      } catch {
        workspace = undefined;
      }
      if (workspace && typeof workspace.openSession === 'function') {
        try {
          workspace.openSession(sessionId);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }

    /**
     * 接单台按钮。
     * - 单击：/court/secretary/ensure（有就复用并解档，没有就新建）→ 跳到该会话。
     * - 长按 0.42s 后向右拖过 56px 松手：/court/secretary/reset（归档旧的 + 新建一个）→ 跳到新会话。
     * 手势阈值存在是为了防止误触把正在用的秘书会话换掉。
     */
    function SecretaryButton({ jump, refresh, compact, wide }) {
      const [busy, setBusy] = React.useState(false);
      const [flash, setFlash] = React.useState(null);
      const [dx, setDx] = React.useState(0);
      const [armed, setArmed] = React.useState(false);
      const press = React.useRef(null);
      const suppress = React.useRef(false);
      const go = typeof jump === 'function' ? jump : jumpToSession;

      const clearPress = () => {
        if (press.current && press.current.timer) clearTimeout(press.current.timer);
        press.current = null;
        setArmed(false);
        setDx(0);
      };

      const open = async () => {
        if (busy) return;
        setBusy(true);
        setFlash(null);
        try {
          const ensured = await courtApi.ensureSecretary();
          if (typeof refresh === 'function') await refresh();
          if (!go(ensured && ensured.sessionId)) setFlash('已就绪，但界面跳不过去；请到侧栏找「接单台」');
        } catch (failure) {
          setFlash('打开接单台失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setBusy(false);
        }
      };

      const reset = async () => {
        if (busy) return;
        setBusy(true);
        setFlash('正在换一个接单台…');
        try {
          const next = await courtApi.resetSecretary();
          if (typeof refresh === 'function') await refresh();
          if (next && next.sessionId) go(next.sessionId);
          setFlash(null);
        } catch (failure) {
          setFlash('换接单台失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setBusy(false);
        }
      };

      const onPointerDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const point = { x: event.clientX, y: event.clientY, dragged: false, timer: null };
        press.current = point;
        setArmed(false);
        setDx(0);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 不支持捕获就算了，move 仍会冒泡 */
        }
        point.timer = setTimeout(() => {
          if (press.current === point) setArmed(true);
        }, SECRETARY_HOLD_MS);
      };

      const onPointerMove = (event) => {
        const point = press.current;
        if (!point) return;
        const deltaX = event.clientX - point.x;
        const deltaY = Math.abs(event.clientY - point.y);
        if (!armed && !point.dragged && deltaY > 24) {
          clearPress();
          return;
        }
        if (!armed) return;
        if (deltaX > 0 && deltaX > deltaY) {
          point.dragged = true;
          setDx(Math.min(110, deltaX));
        }
      };

      const onPointerUp = (event) => {
        const point = press.current;
        if (!point) return;
        const shouldReset = point.dragged && event.clientX - point.x >= SECRETARY_SWIPE_PX;
        if (point.timer) clearTimeout(point.timer);
        press.current = null;
        setArmed(false);
        setDx(0);
        if (shouldReset) {
          suppress.current = true;
          void reset();
        }
      };

      const onClick = () => {
        if (suppress.current) {
          suppress.current = false;
          return;
        }
        void open();
      };

      const gesture = {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: clearPress,
        onClick,
      };

      if (compact) {
        return h('div', {
          className: 'dsc-footbtn' + (dx > 0 ? ' dsc-footbtn--drag' : ''),
          role: 'button',
          tabIndex: 0,
          'aria-label': '接单台',
          title: '接单台：点击进入；长按向右滑动 = 换一个新的',
          style: {
            transform: dx > 0 ? 'translateX(' + Math.round(dx * 0.5) + 'px)' : undefined,
            opacity: busy ? 0.6 : 1,
          },
          ...gesture,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void open();
            }
          },
        },
          h(Icon, { name: 'seal', size: 15 }),
          wide ? h('span', null, '接单台') : null);
      }

      return h('div', { className: 'dsc-toolbar', style: { gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
        h('button', {
          type: 'button',
          className: 'dsc-secbtn'
            + (dx > 0 ? ' dsc-secbtn--drag' : '')
            + (armed && dx === 0 ? ' dsc-secbtn--armed' : ''),
          disabled: busy,
          title: '接单台：点击进入；长按向右滑动 = 归档当前接单台并新建一个',
          style: { transform: dx > 0 ? 'translateX(' + Math.round(dx * 0.6) + 'px)' : undefined },
          ...gesture,
        },
          h(Icon, { name: 'seal', size: 14 }),
          h('span', null, busy ? '接单台…' : '接单台'),
          h('span', { className: 'dsc-secbtn-hint' },
            armed
              ? (dx >= SECRETARY_SWIPE_PX ? '松手 → 换新' : '继续右滑 →')
              : '点击进入 · 长按右滑换新')),
        flash ? h('span', { className: 'dsc-note' }, flash) : null);
    }

    // ---------------------------------------------------------------------
    // 项目参考：从已有会话里多选几条聊天记录
    // ---------------------------------------------------------------------

    /** 多选弹层：左列会话（万象工阁 + 你的其他会话），右列消息；点行即勾选。 */
    function ReferencePicker({ title, onClose, onPick }) {
      const [rows, setRows] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [activeId, setActiveId] = React.useState(null);
      const [messages, setMessages] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [picked, setPicked] = React.useState({});
      const [busy, setBusy] = React.useState(false);
      const [query, setQuery] = React.useState('');

      React.useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const result = await courtApi.sessions();
            if (!alive) return;
            const list = (result && result.sessions) || [];
            setRows(list);
            if (list.length > 0) setActiveId(list[0].sessionId);
          } catch (failure) {
            if (alive) setError('读会话列表失败：' + (failure && failure.message ? failure.message : String(failure)));
          }
        })();
        return () => {
          alive = false;
        };
      }, []);

      React.useEffect(() => {
        if (!activeId) return undefined;
        let alive = true;
        setLoading(true);
        setMessages(null);
        setPicked({});
        setError(null);
        courtApi.messages(activeId)
          .then((result) => {
            if (alive) setMessages((result && result.messages) || []);
          })
          .catch((failure) => {
            if (alive) setError('读会话记录失败：' + (failure && failure.message ? failure.message : String(failure)));
          })
          .finally(() => {
            if (alive) setLoading(false);
          });
        return () => {
          alive = false;
        };
      }, [activeId]);

      const pickedList = (messages || []).filter((message) => picked[message.seq]);
      const allPicked = Boolean(messages && messages.length > 0 && pickedList.length === messages.length);

      const toggle = (seq) => setPicked((prev) => ({ ...prev, [seq]: !prev[seq] }));
      const selectAll = () => {
        if (!messages) return;
        if (allPicked) {
          setPicked({});
          return;
        }
        const next = {};
        for (const message of messages) next[message.seq] = true;
        setPicked(next);
      };

      const submit = async () => {
        if (busy || pickedList.length === 0) return;
        setBusy(true);
        setError(null);
        try {
          const row = (rows || []).find((item) => item.sessionId === activeId);
          const firstUser = (messages || []).find((message) => message.role === 'user');
          const label = row && row.role !== 'dsh' && row.title
            ? row.title
            : (firstUser ? firstUser.text.replace(/\s+/g, ' ').slice(0, 24) : '会话');
          await onPick({
            sessionId: activeId,
            sessionLabel: label,
            kind: allPicked ? 'session' : 'messages',
            items: pickedList.map((message) => ({
              role: message.role,
              at: message.at,
              text: message.text,
            })),
          });
          onClose();
        } catch (failure) {
          setError('加进项目参考失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setBusy(false);
        }
      };

      const groups = [
        { key: 'court', label: '万象工阁（接单台 / 工位 / 工程师）' },
        { key: 'dsh', label: '我的其他会话' },
      ];

      return h('div', {
        className: 'dsc-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '加入项目参考',
        onPointerDown: (event) => {
          if (event.target === event.currentTarget) onClose();
        },
      },
        h('div', { className: 'dsc-modal-card' },
          h('div', { className: 'dsc-modal-head' },
            h('div', { className: 'dsc-modal-title' }, title || '加入项目参考'),
            h('button', { type: 'button', className: 'dsc-btn dsc-btn--sm', onClick: onClose }, '关闭')),
          h('div', { className: 'dsc-modal-body' },
            h('div', { className: 'dsc-modal-side', role: 'listbox', 'aria-label': '会话' },
              rows === null
                ? h('div', { className: 'dsc-note', style: { padding: 8 } }, '读会话列表…')
                : h('div', null,
                  h('input', {
                    className: 'dsc-input',
                    style: { margin: '2px 6px 6px', fontSize: 12, width: 'calc(100% - 12px)' },
                    placeholder: '搜会话名…',
                    value: query,
                    onChange: (event) => setQuery(event.target.value),
                  }),
                  groups.map((group) => {
                    const keyword = query.trim();
                    const items = rows.filter((row) => (row.group || 'court') === group.key
                      && (!keyword
                        || String(row.title || '').includes(keyword)
                        || String(row.projectName || '').includes(keyword)));
                    if (items.length === 0) return null;
                    return h('div', { key: group.key },
                      h('div', { className: 'dsc-msgmeta', style: { padding: '8px 10px 2px' } },
                        group.label + ' · ' + items.length),
                      items.map((row) => h('button', {
                        key: row.sessionId,
                        type: 'button',
                        className: 'dsc-sideitem',
                        'aria-selected': row.sessionId === activeId ? 'true' : 'false',
                        onClick: () => setActiveId(row.sessionId),
                      },
                        h('div', null, row.title || '会话'),
                        h('div', { className: 'dsc-msgmeta' },
                          row.role === 'secretary'
                            ? '接单台'
                            : (row.group === 'dsh' ? '普通会话' : (row.projectName || '万象工阁'))))));
                  }))),
            h('div', { className: 'dsc-modal-main' },
              error ? h('div', { className: 'dsc-error' }, error) : null,
              loading
                ? h('div', { className: 'dsc-note' }, '正在读会话记录…')
                : messages === null
                  ? h('div', { className: 'dsc-note' }, rows && rows.length === 0
                    ? '没有可选的会话。'
                    : '选左边的会话，看它的聊天记录。')
                  : messages.length === 0
                    ? h(Empty, null, '这个会话还没有可选的聊天记录。')
                    : messages.map((message) => h('button', {
                      key: message.seq,
                      type: 'button',
                      className: 'dsc-msgrow',
                      'aria-selected': picked[message.seq] ? 'true' : 'false',
                      onClick: () => toggle(message.seq),
                    },
                      h('span', { className: 'dsc-msgcheck' },
                        picked[message.seq] ? h(Icon, { name: 'check', size: 11 }) : null),
                      h('span', { style: { minWidth: 0, flex: 1 } },
                        h('div', { className: 'dsc-msgmeta' },
                          (message.role === 'assistant' ? 'AI' : '用户') + ' · ' + timeAgo(message.at)),
                        h('div', { className: 'dsc-msgtext' }, message.text)))))),
          h('div', { className: 'dsc-modal-foot' },
            h('span', { className: 'dsc-note' }, '已选 ' + pickedList.length + ' 条'),
            h('div', { className: 'dsc-toolbar' },
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--sm',
                disabled: !messages || messages.length === 0,
                onClick: selectAll,
              }, allPicked ? '取消全选' : '全选'),
              h('button', { type: 'button', className: 'dsc-btn', onClick: onClose }, '取消'),
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--primary',
                disabled: pickedList.length === 0 || busy,
                onClick: () => void submit(),
              }, busy ? '加入中…' : '加进项目参考')))));
    }

    /** 项目详情里的「项目参考 / 项目附件」区块。 */
    function ProjectMaterials({ project, refresh, setFlash }) {
      const [picking, setPicking] = React.useState(false);
      const [busyId, setBusyId] = React.useState(null);
      const references = project.references || [];
      const attachments = project.attachments || [];

      const removeReference = async (reference) => {
        if (busyId) return;
        setBusyId(reference.id);
        try {
          await courtApi.removeReference(project.id, reference.id);
          await refresh();
        } catch (failure) {
          if (typeof setFlash === 'function') {
            setFlash('移除参考失败：' + (failure && failure.message ? failure.message : String(failure)));
          }
        } finally {
          setBusyId(null);
        }
      };

      const removeAttachment = async (attachment) => {
        if (busyId) return;
        setBusyId(attachment.id);
        try {
          await courtApi.deleteAttachment(project.id, attachment.id);
          await refresh();
        } catch (failure) {
          if (typeof setFlash === 'function') {
            setFlash('移除附件失败：' + (failure && failure.message ? failure.message : String(failure)));
          }
        } finally {
          setBusyId(null);
        }
      };

      return h('div', null,
        h('section', { className: 'dsc-section' },
          h('div', { className: 'dsc-section-head' },
            h('span', { className: 'dsc-section-title' }, '项目参考'),
            h('span', { className: 'dsc-section-hint' },
              references.length + ' 条 · 自动带进该项目的会话')),
          h('div', { className: 'dsc-card' },
            references.length === 0
              ? h('div', { className: 'dsc-note' },
                '还没有参考。可以把某次会话里聊清楚的需求、约束、结论挑几条进来，'
                + '之后这个项目的每个会话（架构师/评审/项目经理/工程师）都会自动带上。')
              : references.map((reference) => h('div', { key: reference.id, className: 'dsc-refitem' },
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { className: 'dsc-row', style: { marginTop: 0 } },
                    h('span', { className: 'dsc-name' },
                      '「' + (reference.sessionLabel || '会话') + '」'
                      + (reference.kind === 'session' ? ' 整段' : ' ' + reference.items.length + ' 条')),
                    h('span', { className: 'dsc-meta' }, timeAgo(reference.createdAt))),
                  h('div', { className: 'dsc-reftext' },
                    (reference.items[0] ? reference.items[0].text : '').slice(0, 140)
                    + (reference.items.length > 1 ? ' …' : ''))),
                h('button', {
                  type: 'button',
                  className: 'dsc-btn dsc-btn--sm',
                  disabled: busyId === reference.id,
                  onClick: () => void removeReference(reference),
                }, '移除'))),
            h('div', { className: 'dsc-actions' },
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--sm dsc-btn--primary',
                onClick: () => setPicking(true),
              }, '＋ 从会话里选…')))),
        attachments.length > 0
          ? h('section', { className: 'dsc-section' },
            h('div', { className: 'dsc-section-head' },
              h('span', { className: 'dsc-section-title' }, '项目附件'),
              h('span', { className: 'dsc-section-hint' }, attachments.length + ' 个 · 立项时拖进来的')),
            h('div', { className: 'dsc-card' },
              attachments.map((attachment) => h('div', { key: attachment.id, className: 'dsc-row', style: { marginTop: 0 } },
                h('div', { className: 'dsc-rowmain', style: { minWidth: 0 } },
                  h('span', { className: 'dsc-name' }, attachment.name),
                  h('span', { className: 'dsc-meta dsc-mono', title: attachment.path, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    attachment.path)),
                h('div', { className: 'dsc-toolbar' },
                  h('span', { className: 'dsc-meta' }, formatBytes(attachment.bytes)),
                  h('button', {
                    type: 'button',
                    className: 'dsc-btn dsc-btn--sm',
                    disabled: busyId === attachment.id,
                    onClick: () => void removeAttachment(attachment),
                  }, '移除'))))))
          : null,
        picking
          ? h(ReferencePicker, {
            title: '加入项目参考 · ' + project.name,
            onClose: () => setPicking(false),
            onPick: async (selection) => {
              await courtApi.addReference({ projectId: project.id, ...selection });
              await refresh();
            },
          })
          : null);
    }

    // ---------------------------------------------------------------------
    // 备份开关：手动 / 自动（一个按钮，不再有第二个「备份」动作）
    // ---------------------------------------------------------------------

    /**
     * 备份模式按钮：显示「备份：手动 / 备份：自动」，点一下切换。
     * 切到自动时会立刻先存一份，所以"切开关"本身就等于一次备份。
     * 面板头用普通按钮，输入框下方用小号 chip；两处共用同一个宿主接口。
     */
    function BackupModeButton({ compact, on, refresh }) {
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState(null);
      const [bad, setBad] = React.useState(false);
      const [selfOn, setSelfOn] = React.useState(null);

      React.useEffect(() => {
        if (on !== undefined) return undefined;
        let alive = true;
        (async () => {
          try {
            const state = await courtApi.state();
            if (alive) setSelfOn(Boolean(state && state.settings && state.settings.backupMode));
          } catch {
            /* 读不到就按关处理 */
          }
        })();
        return () => {
          alive = false;
        };
      }, [on]);

      const current = on !== undefined ? Boolean(on) : Boolean(selfOn);

      // 结果提示只留 6 秒，别长期占着输入框下面那行。
      React.useEffect(() => {
        if (!note) return undefined;
        const timer = setTimeout(() => setNote(null), 6000);
        return () => clearTimeout(timer);
      }, [note]);

      const toggle = async () => {
        if (busy) return;
        const next = !current;
        setBusy(true);
        setBad(false);
        setNote(null);
        try {
          await courtApi.setBackupMode(next);
          if (next) {
            const saved = await courtApi.backup(true);
            const name = String(saved && saved.file ? saved.file : '').split(/[\\/]/).pop();
            const stamp = /^\d{8}-(\d{2})(\d{2})/.exec(name || '');
            setNote(stamp ? `已存 ${stamp[1]}:${stamp[2]}` : '已存一份');
          } else {
            setNote('已停止');
          }
          if (on === undefined) setSelfOn(next);
          if (typeof refresh === 'function') await refresh();
        } catch (failure) {
          setBad(true);
          setNote('切换失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setBusy(false);
        }
      };

      const label = current ? '备份：自动' : '备份：手动';
      const title = current
        ? '自动备份已开：每 15 分钟存一个包，只留最近 10 个。点一下切回手动。'
        : '现在是手动备份（只有点开关才存）。点一下开自动：每 15 分钟存一个包，只留最近 10 个。纯本地，不花 token。';

      if (compact) {
        return h('span', { className: 'dsc-backupchip' },
          h('button', {
            type: 'button',
            title,
            'aria-pressed': current ? 'true' : 'false',
            disabled: busy,
            onClick: () => void toggle(),
          }, h(Icon, { name: 'seal', size: 12 }), busy ? '切换中…' : label),
          note
            ? h('div', { className: 'dsc-toast' + (bad ? ' dsc-toast--bad' : '') }, '备份模式提示：' + note)
            : null);
      }

      return h('button', {
        type: 'button',
        className: 'dsc-btn dsc-btn--sm' + (current ? ' dsc-btn--primary' : ''),
        title,
        'aria-pressed': current ? 'true' : 'false',
        disabled: busy,
        onClick: () => void toggle(),
      }, busy ? '切换中…' : label);
    }

    // ---------------------------------------------------------------------
    // 主面板：一个入口，四个区
    // ---------------------------------------------------------------------

    function CompanyPanel(props) {
      const { t, close, jump } = props;
      const tr = (key) => (typeof t === 'function' ? t(key) : zh[key] || key);
      const { data, error, refresh } = useCourt();
      const [tab, setTab] = React.useState('secretary');
      const [focusId, setFocusId] = React.useState(null);
      const [focusMode, setFocusMode] = React.useState(null);
      const [switchBusy, setSwitchBusy] = React.useState(null);
      const pending = data && data.pendingJump;
      const staleHost = Boolean(data) && !data.apiVersion;
      const secretarySessionId = data && data.settings ? data.settings.secretarySessionId : null;

      // 打开面板就顺手检查秘书会话是否被归档；归档状态下投递会被 DSH 直接判 blocked。
      React.useEffect(() => {
        if (!secretarySessionId) return;
        void unarchiveCurrentSecretary(secretarySessionId);
      }, [secretarySessionId]);

      const go = (nextTab, projectId, mode = null) => {
        setTab(nextTab);
        setFocusId(projectId || null);
        setFocusMode(mode || null);
      };

      const grantOn = Boolean(data && data.settings && data.settings.grantFullAccess);
      const backupOn = Boolean(data && data.settings && data.settings.backupMode);

      /** 放权开关：把万象工阁所有会话切到「完全权限」，新会话也自动放权。 */
      const toggleGrant = async () => {
        if (switchBusy) return;
        setSwitchBusy('grant');
        try {
          await courtApi.setGrant(!grantOn);
          await refresh();
        } catch (failure) {
          window.alert('放权切换失败：' + (failure && failure.message ? failure.message : String(failure)));
        } finally {
          setSwitchBusy(null);
        }
      };

      const dismissJump = async () => {
        try {
          await courtApi.clearJump();
          await refresh();
        } catch {
          /* 清不掉就等下次轮询 */
        }
      };

      const takeJump = async () => {
        if (!pending) return;
        if (typeof jump === 'function' && jump(pending.sessionId)) {
          await dismissJump();
        }
      };

      const sayToSecretary = async (text) => {
        const result = await tellSecretary(text);
        const next = await refresh();
        if (result && result.sessionId && typeof jump === 'function') {
          if (!jump(result.sessionId)) {
            throw new Error('秘书会话已创建，但界面跳不过去；请到侧栏的「万象工阁」工作区里找它');
          }
        }
        return next;
      };

      return h('div', { className: 'dsc-root' },
        h('style', null, CSS),
        h('div', { className: 'dsc-wrap' },
          h('div', { className: 'dsc-head' },
            h('div', null,
              h('div', { className: 'dsc-eyebrow' }, '幻盏 · 万象幻容 · UI 2.3.0'),
              h('h1', { className: 'dsc-title' }, tr('app.title')),
              h('p', { className: 'dsc-sub' }, tr('sub.' + tab)),
              h('p', { className: 'dsc-credit' }, tr('app.credit'))),
            h('div', { className: 'dsc-headside' },
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--sm' + (grantOn ? ' dsc-btn--primary' : ''),
                disabled: switchBusy !== null,
                title: grantOn
                  ? '放权已开：万象工阁所有会话 = 完全权限（不再弹审批）。点一下关掉，回到工作区内修改。'
                  : '一键放权：把接单台和各岗位会话切到「完全权限」，以后新建的万象工阁会话也自动放权。',
                onClick: () => void toggleGrant(),
              }, switchBusy === 'grant' ? '切换中…' : (grantOn ? '放权：开' : '放权：关')),
              h(BackupModeButton, { on: backupOn, refresh }),
              h(SecretaryButton, { jump, refresh }),
              h('button', {
                type: 'button',
                className: 'dsc-btn',
                onClick: () => {
                  if (typeof close === 'function') close();
                },
              }, '返回对话'))),
          h('div', { className: 'dsc-tabs', role: 'tablist' },
            TABS.map((entry) => h('button', {
              key: entry.id,
              type: 'button',
              role: 'tab',
              className: 'dsc-tab',
              'aria-selected': tab === entry.id ? 'true' : 'false',
              onClick: () => {
                setTab(entry.id);
                setFocusId(null);
                setFocusMode(null);
              },
            }, tr(entry.label)))),
          staleHost
            ? h('div', {
              className: 'dsc-banner',
              style: { borderColor: 'rgba(220,38,38,.5)' },
            },
              h('span', { className: 'dsc-banner-text' },
                '宿主半侧是旧版（缺少 /secretary 等新接口）：重启一次 DSH，这些按钮才真正生效'))
            : null,
          pending
            ? h('div', { className: 'dsc-banner' },
              h('span', { className: 'dsc-banner-text' },
                '有新的移交：' + (pending.label || '下一省') + ' 已就绪'),
              h('button', {
                type: 'button',
                className: 'dsc-btn dsc-btn--sm dsc-btn--primary',
                onClick: takeJump,
              }, '去这里 →'),
              h('button', { type: 'button', className: 'dsc-btn dsc-btn--sm', onClick: dismissJump }, '稍后'))
            : null,
          tab === 'secretary'
            ? h(SecretaryView, { data, error, onGo: go, onSay: sayToSecretary })
            : tab === 'chancellery'
              ? h(ChancelleryView, { data, error, refresh, jump })
              : tab === 'hall'
                ? h(HallView, { data, error, refresh, jump, focusId, focusMode })
                : h(ScriptoriumView, { data, error, refresh })));
    }

    // ---------------------------------------------------------------------
    // 注册
    // ---------------------------------------------------------------------

    function makeJump(ctx) {
      return (sessionId) => {
        if (!sessionId) return false;
        let workspace;
        try {
          workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
        } catch {
          workspace = undefined;
        }
        if (workspace && typeof workspace.openSession === 'function') {
          try {
            workspace.openSession(sessionId);
            return true;
          } catch {
            return false;
          }
        }
        return false;
      };
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        clientCtx = ctx;

        /** 样式挂到 document.head：面板没打开时，输入框下方那枚小按钮也得有样式。 */
        function installStyles() {
          if (typeof document === 'undefined') return () => {};
          const tagId = 'wanxiang-hall/styles';
          if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return () => {};
          const tag = document.createElement('style');
          tag.dataset.plugin = NS;
          tag.dataset.pluginCss = tagId;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
          };
        }
        ctx.effect(() => installStyles(), 'court: styles');
        const bound = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'court: dictionaries');

        const jump = makeJump(ctx);

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'wanxiang-hall',
          order: 5,
          label: () => bound('app.title'),
          locale: NS,
        }, (props) => h(Icon, { name: 'company', size: 16 })));

        // 输入框下方的小备份按钮：改坏东西时一键回滚到最后一次备份。
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'court-backup',
          order: 60,
          locale: NS,
        }, () => h(BackupModeButton, { compact: true })));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'wanxiang-hall',
          locale: NS,
          inject: () => ({
            close: () => ctx.layout.selectPanel(null),
            jump,
          }),
        }, CompanyPanel));

        // 这五个角色只属于万象工阁内部，不应出现在「新建会话」的通用 Agent 模式菜单里。
        ctx.effect(() => installPresetMenuFilter(), 'court: hide role presets from mode menu');
      },
    };
  },
});
;
//# sourceMappingURL=??dsh-wanxiang-hall/client.js.map&rev=aaa6264ee6cb
