# 架构

## 一句话

万象工阁 = **一份状态**（store）+ **一张状态图**（auth/PIPELINES）+ **一组闸门**（tools/handoff）+ **一个判活器**（activity）+ **两个记忆**（kb / vault）+ **一个面板**（client）+ **一个巡夜人**（index 的定时器）。

## 模块地图

| 文件 | 行数 | 职责 | 依赖 |
|---|---|---|---|
| `index.js` | ~1690 | 宿主侧：`apply(ctx)`、`/court` HTTP 路由、系统提示注入、巡夜、一键备份 | store / handoff / activity / kb / brand |
| `tools.js` | ~3210 | 33 个 `court_*` Agent 工具与其闸门 | store / auth / handoff / checks / ownership / packages / context / kb |
| `client.js` | ~3485 | 面板（React + `h()`，打包成单文件 bundle） | 纯 HTTP，无宿主依赖 |
| `store.js` | ~750 | 唯一真源：`court.json` + `kb.json`，原子写、串行化、空状态守卫 | auth / kb |
| `auth.js` | ~240 | 三编制 `PIPELINES`、席位、转移合法性、文书权限与类型 | 无 |
| `handoff.js` | ~552 | 交接引擎：闸门 → 组装提示 → 开会话/投消息 → 按铃 | store / auth / context / packages / brand |
| `activity.js` | ~247 | 心跳：会话日志 mtime → 六态；时间盒 | 无 |
| `context.js` | ~155 | 项目索引（≤2000 字）、文书指针、硬预算 | kb |
| `kb.js` | ~269 | 企业智库：归一化、分词（中文二元组）、打分、提炼候选 | store（仅 num/str） |
| `packages.js` | ~135 | 工单：状态机、文件冲突检测、依赖拓扑、就绪选择 | 无 |
| `ownership.js` | ~85 | 极简 glob 与越界审计 | 无 |
| `checks.js` | ~413 | 验收命令：预跑探测、执行、日志、GBK 解码 | snapshot |
| `snapshot.js` | ~227 | 基线快照与 diff | — |
| `fork.js` | ~80 | 承接立项：继承工作区/上下文/归属/验收/会话 | auth |
| `vault.js` | ~334 | 对外出口：写 LLM Wiki 的 `raw/sources`、检查同步状态 | 无 |
| `diff.js`、`sessions.js`、`brand.js` | 小 | 文本 diff / 会话开关与投递 / 品牌与岗位名 | 无 |

## 一次完整的活怎么走

```
客户 → 接单台（秘书）→ court_create_project(shape)
     → 架构师：court_get_project → 读工作区 → court_save_brief(kind=contract/plan)
     → court_confirm_scope（客户/秘书签字，锁 approvedPlanId）
     → [项目组] 评审：court_submit_verdict(pass | reject+mustFix≤3)
        └ reject → 架构师 court_revise_brief(fixes=[1,2]) → 回到评审（最多 2 轮）
     → 项目经理：court_set_packages → court_set_quote → court_update_package(doing)
     → 工程师：读工单 → 改「只许改」的文件 → court_verify → court_save_brief(report)
     → court_audit（越界审计）→ 评审/秘书 court_update_project(done)
     → 结项：court_kb_digest（收结论）→ 收进知识库（可选）
```

每一步的「能不能走」都由 `auth.js` 的 `canTransition` + `tools.js` 的闸门决定，**角色自己想推是推不动的**。

## 为什么这样分层

- **状态与呈现分离**：面板不持有任何自己的状态，所有数字都从 `/court/state` 派生。心跳、健康、时间盒、四象限都是**算出来的**，所以不会出现「面板说在跑，其实死了」或「面板说 0 进度，其实干了 72 件事」。
- **约束与提示分离**：闸门写在代码里（会抛错），提示写在 preset 里（只是建议）。只靠提示词约束的流程，长跑必崩。
- **记忆与项目分离**：项目状态（court.json）与企业记忆（kb.json）分文件。前者每次变更都要重写，后者只追加；混在一起会把 8K 正文的写放大变成常态。

## 进程模型

插件跑在 DSH 宿主的同一个 Node 进程里（`ctx.inject(['webServer'])`）；状态是模块级单例，`update()` 串行化 + tmp/rename 原子写。插件内**不要**自己重启宿主——脚本随宿主进程树一起被杀（我们试过，恢复步骤没执行）。

## 数据一致性

- `update(mutator)`：读 → 改 → 写，串行；写盘前 `copyFile(court.json, court.json.prev)`。
- 空状态守卫：本次要写 0 个项目而磁盘上有 N 个 → 拒写并抛错。
- 读失败不静默降级：`read()` 只在 ENOENT 时当作空库，其它异常记 `readProblem()` 并拒绝后续写入。
