# 万象工阁 · Wanxiang Gongge

> 一个人的公司，五个人的产出。
> A one-person agency inside [DeepSeek Harness](https://github.com/deepseek-ai): intake → architecture → review → dispatch → build → acceptance → delivery, with hard gates and a receipt for every hand-off.

万象工阁是 DeepSeek Harness（DSH）的一个插件：它把「接单、架构、评审、派工、施工、验收、交付」这套外包公司的流程，落成一组会互相把关的 Agent 岗位 + 一组不可绕过的硬闸门 + 一个能看见「谁在干活、卡在哪」的面板。

由 **幻盏**（公司）/ **万象幻容**（团队）制作 · Made by Huanzhan Yanlu.

---

## 它解决什么问题

单 Agent 干长活，常见的三种崩法：

1. **看起来在干活**：会话里有几百条动作，面板上却 0 进度 —— 因为「进度」靠角色自己申报，而不是从行为推出来。
2. **驳回变成全文重写**：评审说「第 3 点不行」，作者把整篇重发一遍并顺手改了没被要求改的地方，一轮比一轮长（真实案例：6 轮驳回、9 版方案、文档从 25K 膨胀到 60K）。
3. **没有收敛判据**：什么算通过、能驳几轮、什么时候必须叫人，全靠人的耐心。

万象工阁的三条对策：

- **事实层**：心跳从会话日志的 mtime 推出来（`activity.js`），六态（working / quiet / stale / stuck / dead / unassigned）全部是**派生值，不落库**；「正在跑」不等于「活着」。
- **约束层**：状态转移由 `PIPELINES[编制]` 的纯数据表决定，每个阶段带 `requires` 硬校验与 `rejectCap` 驳回上限；缺产出、越界改文件、没签范围就开工，都会被拒。
- **呈现层**：面板只显示派生结果 —— 阶段、健康、工单、时间盒、四象限优先级、待你出面的事。

---

## 三种编制（shape）

| 编制 | 席位 | 适用 | 驳回上限 | 时间盒 |
|---|---|---|---|---|
| `squad` 轻量组 | 架构师 + 交付工程师 | 改一个模块、修一批 bug、加接口 | 1 轮 | 8h |
| `crew` 项目组 | 架构师 → 评审 → 项目经理 → 工程师 | 多模块、跨端、需要拆工单与集成 | 2 轮 | 40h |
| `line` 流水线 | 架构师 → 项目经理 → 工程师（多张工单） | 批量同质任务 | 1 轮 | 不限 |

轻量组不出评审席：**谁施工谁审方案**（要为自己的工期负责），代码验收交给自动校验 + 抽验 diff。
完整组才有独立评审，因为那里「需求有没有跑偏」无法自动验证。

## 五个岗位

| 内部 id | 显示名 | 干什么 |
|---|---|---|
| `secretary` | 交付秘书 | 接单、立项、答疑、代签、抽验、结项 |
| `zhongshu` | 架构师 | 需求 → 契约 / 方案 / 工单拆分依据 |
| `menxia` | 评审（仅项目组） | 结构化驳回（mustFix ≤ 3 条）或放行 |
| `shangshu` | 项目经理（轻量组里叫交付工程师，流水线里叫工单调度） | 拆工单、派活、集成、报价与结算 |
| `executor` | 工程师 | 按工单改代码，只许改工单声明的文件 |

用户 = **客户**。客户签的字（范围、延期、结项）是唯一不能由机器代填的东西。

---

## 四张台

- **接单台**：跟秘书说一句话就立项；四象限（重要/紧急）+ 项目总览。
- **工位**：每个项目一条岗位链，点节点直接跳进对应会话。
- **项目看板**：阶段、健康、工单、时间盒、文书、验收、智库命中。
- **智库**：企业级记忆（决策 / 约定 / 坑 / 做法 / 工具 / 术语 / 客户偏好），跨项目复用，移交时自动注入 3 条。

## 十三道硬闸门（摘要）

1. 省际推进只能靠 `court_handoff`，且必须落在 `PIPELINES` 允许的边上。
2. 阶段 `requires` 校验：该有的文书没有，不放行。
3. 驳回上限按编制算，超了必须叫客户裁决，不许自循环。
4. 驳回后修订必须 `fixes:[1,2]` 逐条清账，且不许越改越长。
5. 文书按类型硬预算（契约 6K、方案 12K、工单 2K…），超了报 `BRIEF_TOO_LONG`。
6. 移交不重发正文：只给索引 + 指针，接收方用 `court_read_brief` 按需读。
7. 开工前必须签范围（`court_confirm_scope`），且签字前必须有方案文书。
8. 派工前校验工单文件集不重叠（`pathsConflict`），重叠必须声明 `dependsOn`。
9. 结项前跑越界审计：改了声明之外的文件 → `out-of-scope` 直接拒。
10. 验收命令登记时先预跑（env / encoding 判死），谎报「跑不过」当场暴露。
11. 《用户操作单》只有秘书或客户本人能勾，工程师不能宣布「用户那步做完了」。
12. 时间盒到点必须叫客户三选一（砍范围 / 延期 / 结项），不自动续期。
13. 空状态守卫：磁盘上还有项目而本次要写空状态，直接拒写（防「读不到就当空库」覆盖真数据）。

细节见 [`docs/gates.md`](docs/gates.md)。

---

## 安装

万象工阁是一个 DSH 插件包，包名 `dsh-wanxiang-hall`，宿主侧零依赖（只用 Node 内置模块）。

### 三条安装路线，任选一条

**A. 从 npm 装**（发布后最省事，一行）

```bash
npm i dsh-wanxiang-hall --prefix <DSH_HOME>/profiles/<profile>
```

**B. 从 GitHub 直接装**（不用发 npm，npm 会帮你把仓库当 tarball 拉下来）

```jsonc
// <DSH_HOME>/profiles/<profile>/package.json
{
  "dependencies": { "dsh-wanxiang-hall": "github:<你的账号>/wanxiang-hall" }
}
```

**C. 本地开发装**（改代码即时生效，改完不用重装）

```bash
git clone <this-repo> ~/wanxiang-hall
```

```jsonc
// <DSH_HOME>/profiles/<profile>/package.json
{
  "dependencies": { "dsh-wanxiang-hall": "link:~/wanxiang-hall" }
}
```

> **为什么本地装也能「直接用」**：DSH 从 profile 的 `node_modules` 解析插件，`link:` 会在 `node_modules/dsh-wanxiang-hall` 建一个目录联接指向仓库。npm 不是运行前提，只是「把包送到 `node_modules`」的一种运输方式。

插件自带 `cordis.patch.yml` 与 `presets/court.patch.yml`，会注册：

- 一个 `webServer` 路由前缀 `/court`（面板数据、智库、备份）；
- 一组 `court_*` 工具（宿主与 Agent 共用）；
- 五个会话预设（交付秘书 / 架构师 / 评审 / 项目经理 / 工程师）；
- 一个系统提示注入（把当前项目的索引塞进上下文，order 130）；
- 一个巡夜定时器（10 分钟一轮：判活、催办、升级）。

> 版本差异提示：DSH 的插件登记方式随版本演进，如果你的版本有插件管理器，按包名或本地包路径安装即可。

## 数据放在哪

| 内容 | 位置 | 说明 |
|---|---|---|
| 项目状态 | `<DSH_HOME>/court/court.json` | 只放项目，不放记忆 |
| 企业智库 | `<DSH_HOME>/court/kb.json` | 与项目分开：8K 正文混进 court.json 会让每次命中计数都重写整个文件 |
| 基线与验收日志 | `<DSH_HOME>/court/baselines/`、`verifications/` | |
| 一键备份 | `$COURT_BACKUP_DIR` 或 `~/.dsh/court-backups` | 插件源码 + profile 配置 + 状态，滚动保留 10 份 |
| 知识库出口（可选） | 自己填 | 没有默认值；不填只是不能「收进知识库」 |

环境变量：`COURT_STATE_DIR`（状态目录，测试用）、`COURT_BACKUP_DIR`、`COURT_SESSIONS_ROOT`（会话日志根，心跳用）。

## 开发

```bash
node --check index.js        # 语法
node --test                  # 128 条单元/回归测试（必须裸跑，不要 node --test test/）
```

约定：

- **不要用 `Get-Content`/`Set-Content` 改这些 `.js`**：Windows PowerShell 会按 GBK 读、按 UTF-8 写，中文全碎且不可逆（我们踩过，丢过 214 字节）。
- Windows 上 `npm`/`npm.ps1` 可能被执行策略拦，用 `node <npm-cli.js>` 或直接跑 node。
- 测试通过 `process.env.COURT_STATE_DIR` 隔离，不会碰真实状态。

## 路线图

- [ ] 评审驳回的三选一做成按钮（现在是文字 + 会话）
- [ ] 文书版本链的 diff 视图（`revisions` 已存，面板只显示字数）
- [ ] `client.js` 拆模块（当前是单文件 bundle）
- [ ] 企业智库接外部向量检索（现在是自实现打分 + 二元组分词）
- [ ] 流水线编制的实战验证

## 许可

MIT，见 [LICENSE](LICENSE)。
