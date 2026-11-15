# 工具清单（33 个）

所有工具都以 `court_` 开头，注册在 DSH 的 `tools` 服务上；宿主路由（`/court/*`）与面板复用的是同一份状态。
**「谁能调」是硬校验**：调用方从会话 id 反查属于哪个项目的哪个席位，反过来推不动。

## 接单与立项

| 工具 | 关键参数 | 说明 |
|---|---|---|
| `court_create_project` | `name` `description` `shape` `workspacePath` `important` `urgent` | 立项。shape ∈ squad/crew/line，默认 squad |
| `court_fork_project` | `fromId` `name` `reuseSessions` `inheritChecks` | 承接：同一仓库的后续，继承工作区/上下文/归属/验收/会话 |
| `court_list_projects` | — | 项目列表（含 shape/状态/进度） |
| `court_get_project` | `projectId` | 单项目详情（含文书元数据、工单、验收、时间盒） |
| `court_set_priority` | `projectId` `important` `urgent` | 四象限（工程师禁） |

## 文书（六张纸 + 通稿）

| 工具 | 关键参数 | 说明 |
|---|---|---|
| `court_save_brief` | `kind` `title` `content` | 12 类文书，按类型硬预算；超了报 `BRIEF_TOO_LONG` |
| `court_read_brief` | `briefId` | 按需读正文（移交只给指针，正文不重发） |
| `court_revise_brief` | `briefId` `content` `append` `fixes` | 打补丁；被驳回时必须 `fixes:[1,2]` 逐条清账，且不许越改越长 |
| `court_submit_verdict` | `decision` `mustFix` `notes` | 评审结论；`mustFix` ≤ 3 条，`pass` 不能带 mustFix |
| `court_confirm_scope` | `projectId` `note` | 客户/秘书签范围；没方案文书报 `MISSING_OUTPUT` |

## 上下文与知识

| 工具 | 关键参数 | 说明 |
|---|---|---|
| `court_set_context` | `map` `stack` `conventions` `gotchas` `topPaths` | 项目上下文（进索引，≤2000 字） |
| `court_set_ownership` | `patterns` | 文件归属声明（越界审计的判据） |
| `court_kb_save` | `kind` `title` `body` `tags` | 写企业智库（跨项目） |
| `court_kb_search` | `query` `kind` `tag` | 检索智库（中文按二元组） |
| `court_kb_digest` | `projectId` | 从项目上下文与交付类文书提炼候选（只读） |
| `court_kb_update` | `id` `pinned` `confidence` `remove` | 改/删（删除仅秘书或客户） |
| `court_vault_search` | `query` | 检索知识库出口（需项目开启 vaultAccess 且已设根目录） |

## 工单与施工

| 工具 | 关键参数 | 说明 |
|---|---|---|
| `court_set_packages` | `packages[]` | 拆工单；文件重叠且无 `dependsOn` 直接拒 |
| `court_update_package` | `packageId` `state` `note` | queued/doing/ready/merged/blocked；`merged` 仅经理或秘书 |
| `court_set_quote` | `rounds` `tokenBudget` | 报价（返工轮次与 token 预算），后续按实际记账 |
| `court_set_appetite` | `hours` `extendHours` | 时间盒；延期要记谁批的 |
| `court_ask_user` | `question` `options` | 向客户提问（阻塞式） |
| `court_update_manual` | `id` `status` | 《用户操作单》勾选；**只有秘书或客户本人能勾** |
| `court_set_manual` | `items[]` | 登记「必须由人做的事」 |

## 验收与审计

| 工具 | 关键参数 | 说明 |
|---|---|---|
| `court_set_checks` | `checks[]` | 登记验收命令；登记时先预跑（env/encoding 判死），失败不放行 |
| `court_verify` | `mode` | 跑全部验收命令；`smoke` 只跑第一条 |
| `court_audit` | `projectId` | 对比基线做越界审计：`ok` / `undeclared` / `out-of-scope` |
| `court_diff` | `projectId` | 基线 diff 摘要 |

## 推进与状态

| 工具 | 关键参数 | 说明 |
|---|---|---|
| `court_handoff` | `projectId` `from` `to` `status` `note` | 唯一合法的省际推进通道；校验席位、转移边、阶段产出、签字 |
| `court_update_project` | `projectId` `status` `note` | 结果态（blocked/review/done/archived）；置 done 走全部闸门 |
| `court_send_message` | `projectId` `role` `text` | 给某个席位投消息（不改变状态） |
| `court_set_workspace` | `projectId` `path` | 绑工作区 |
| `court_rebase_workspace` | `projectId` `path` | 换工作区并重取基线（换完必须重取，否则 diff 全错） |
