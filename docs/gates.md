# 闸门清单

闸门的判据只有两种：**代码里的硬校验**（抛错，绕不过去）与**派生的可见状态**（面板标红，提醒人）。
凡是「只能靠角色自觉」的规则，本文档一律不列为闸门。

## 一、状态机闸门

| # | 闸门 | 位置 | 拒绝时 |
|---|---|---|---|
| 1 | 转移边必须在 `PIPELINES[编制]` 里 | `auth.canTransition` | `handoff` 抛「编制 X 不支持 A→B」 |
| 2 | 目标席位必须存在 | `auth.hasSeat` | 抛「当前编制没有『评审』这个席位」 |
| 3 | 阶段 `requires`：该有的文书必须已存在 | `handoff.performHandoff` | 抛「到 X 之前必须已交 Y」 |
| 4 | 结果态之外的推进禁止走 `court_update_project` | `auth.canUpdateStatus` | 抛「省际推进请用 court_handoff」 |

## 二、评审闸门

| # | 闸门 | 判据 |
|---|---|---|
| 5 | 只有评审能提交 verdict（项目组） | 调用方席位 |
| 6 | `mustFix` ≤ 3 条 | schema + 代码双保险 |
| 7 | `pass` 不能带 `mustFix`；`reject` 至少 1 条 | 代码 |
| 8 | 驳回上限按编制（1 / 2 / 1） | `SHAPE_META[shape].rejectCap` |
| 9 | 被驳回后的修订必须 `fixes:[1,2]` 逐条清账 | `court_revise_brief` |
| 10 | 修订不许越改越长（预算内可改短） | `BRIEF_TOO_LONG` |

## 三、开工与交付闸门

| # | 闸门 | 判据 |
|---|---|---|
| 11 | 开工（`→executing/executor`）前范围必须已签 | `scope.confirmedAt > 0` |
| 12 | 签字前必须有方案文书 | `MISSING_OUTPUT` |
| 13 | 结项前《用户操作单》必须清空（除非秘书/客户本人） | `manual[].status === 'done'` |
| 14 | 结项前越界审计必须 `ok`（有 ownership 才有此项） | `auditChanges().verdict` |
| 15 | 置 `review` 必须是施工者本人，且有开工后的交付文书；有 checks 时必须 verifications 通过 | `executorStartedAt` + `latestVerification` |
| 16 | 置 `done` 必须是秘书/评审（流水线里可是经理），项目组还要求 `latestVerdict.decision === 'pass'` | 席位 + verdict |

## 四、并行安全闸门

| # | 闸门 | 判据 |
|---|---|---|
| 17 | 两张活跃工单的文件集不许重叠，重叠必须声明 `dependsOn` | `packages.validatePackages` → `pathsConflict` |
| 18 | 依赖成环、自依赖、依赖不存在 → 拒绝整批工单 | 同上 |
| 19 | 越界审计：改了声明之外的文件 → `out-of-scope` | `ownership.auditChanges` |

## 五、验收闸门

| # | 闸门 | 判据 |
|---|---|---|
| 20 | 登记验收命令时先预跑：命令起不来 / 编码炸 → 不许登记 | `checks.preflightCheck`（`env` / `encoding`）|
| 21 | 预跑非零退出不判死（代码还没写完是正常的），但要显式 `allowUnproven` 才放行 | 同上 |
| 22 | `shell: powershell` 且命令含 `&&`/`\|\|` → 直接拒（PowerShell 5.1 不认） | `normalizeChecks` |

## 六、时间与成本闸门

| # | 闸门 | 判据 |
|---|---|---|
| 23 | 文书按类型硬预算（契约 6K、方案 12K、工单 2K、报价 1.5K…） | `context.assertBriefBudget` |
| 24 | 移交只给索引 + 指针，正文不重发 | `context.buildIndex` / `briefPointer` |
| 25 | 时间盒到点 → 必须叫客户三选一（砍范围/延期/结项），不自动续期 | `activity.appetiteBreach` |
| 26 | 同一项目催办冷却 30 分钟、最多 2 次，第 3 次转「要你裁决」 | `MAX_NUDGES` / `NUDGE_COOLDOWN_MS` |

## 七、数据安全闸门

| # | 闸门 | 判据 |
|---|---|---|
| 27 | 空状态守卫：本次写 0 个项目而磁盘上有 N 个 → 拒写 | `store.persist` |
| 28 | 读失败不降级：非 ENOENT 异常 → 拒写并报 `stateProblem` | `store.update` |
| 29 | 每次写盘前留 `.prev` | `store.persist` |
| 30 | 只有秘书或客户能勾《用户操作单》、能删知识条目 | 席位校验 |

## 派生状态（不落库、不拦截，只让人看见）

| 状态 | 含义 |
|---|---|
| `working` | 该岗位 15 分钟内有写入 |
| `quiet` | 15–90 分钟无写入（还没到该催的程度） |
| `stale` | > 90 分钟无写入 → 黄色 |
| `stuck` | 进程显示正在跑，但 30 分钟没有新帧 → 红色（**「在跑」不等于「活着」**） |
| `dead` | 会话日志文件不可用 |
| `unassigned` | 该阶段没有会话 |

`settled`（草稿/已交付/已归档/暂停/阻塞）不标色。
