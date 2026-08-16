# 术语表 / Terminology Glossary (A-I18N-001)

> 目标：消除「中英文混杂」——同一概念在界面各处使用同一译名。
> 规则：**界面可见文案以中文为准**；**技术/物种专有名词保留英文**（见「保留英文」一节）。
> 后端与前端通过 **error code / 结构化 status 字段**通信，界面文案不依赖后端报错字符串匹配。

---

## 1. 核心术语对照（UI 标准译名）

| English | 中文（标准译名） | 出现位置 |
|---|---|---|
| New | 新建 | DocumentToolbar / Sidebar / AgentPanel |
| Open | 打开 | DocumentToolbar / Sidebar / 空态卡片 |
| Open file | 打开文件 | DocumentToolbar title |
| Save | 保存 | DocumentToolbar / Sidebar / Inspector |
| Save As | 另存为 | DocumentToolbar / SaveAsDialog 标题 |
| Import | 导入 | DocumentToolbar / Editor 空态 |
| Undo / Redo | 撤销 / 重做 | DocumentToolbar / A-STATE-001 快捷键 |
| Cancel | 取消 | 所有对话框 |
| Delete | 删除 | Sidebar 项目 / Inspector 特征 |
| Rename | 重命名 | Sidebar 项目 |
| Name | 名称 | 所有表单 |
| Type | 类型 | 所有表单 / 表格 |
| Start / End | 起始 / 终止 | 特征表单 / 创建对话框 |
| Strand | 链 | 特征表单（正向 / 反向） |
| Forward / Reverse | 正向 / 反向 | 特征链、引物方向、表格行 |
| Color | 颜色 | 特征表单 |
| Add annotation | 添加注释 | Inspector / 工具轨 / 右键菜单 |
| Add primer | 添加引物 | 工具轨 / 右键菜单 |
| New sequence | 新建序列 | Inspector / 工具轨 / Sidebar |
| Features | 特征 | Sidebar 标签 / OveEditorHost 总览 / 页脚 |
| Inspector | 检查器 | Sidebar 标签 |
| History | 历史记录 | Sidebar 标签 / OveEditorHost 页脚 |
| Tools | 工具 | SequenceToolsMenu |
| Enzymes | 酶 | RestrictionEnzymeMenu |
| All / Primers / Cut sites | 全部 / 引物 / 酶切位点 | Sidebar 筛选 |
| Map / Sequence / Both | 图谱 / 序列 / 双视图 | OveEditorHost 视图切换 |
| Display | 显示 | OveEditorHost 视图工具栏 |
| Clone / Digest / PCR / Align | 克隆 / 酶切 / PCR / 比对 | OveEditorHost 模拟工具 |
| Description | 描述 | OveEditorHost 页脚 |
| Coordinates | 坐标 | SequenceInspector |
| Length | 长度 | SequenceInspector |
| No selection | 未选中 | SequenceInspector |
| Primer details | 引物详情 | SequenceInspector |
| Save changes | 保存更改 | Inspector |
| Copy | 复制 | Inspector / 工具轨 |
| Translation | 翻译 | Inspector（蛋白翻译） |
| Clipboard unavailable | 剪贴板不可用 | Inspector / 验证对话框 |
| Sequence library | 序列文库 | Sidebar |
| Find feature | 查找特征 | Sidebar 搜索 |
| Restore before this step | 恢复到本步骤之前 | DocumentHistoryPanel |
| Clear document history | 清除文档历史 | DocumentHistoryPanel |
| No document history yet | 暂无文档历史记录 | DocumentHistoryPanel |
| Current sequence | 当前序列 | DocumentHistoryPanel |
| Blockers / Assumptions / Warnings | 阻断项 / 假设 / 警告 | TaskConfirmationPanel |
| Required inputs | 必填输入 | TaskConfirmationPanel |
| Expression strategy | 表达策略 | TaskConfirmationPanel |
| Multi-fragment cloning | 多片段克隆 | CloningSetupPanel |
| Assembly method | 组装方法 | CloningSetupPanel / CloningWizard |
| Insert source / name / sequence | 插入片段来源 / 名称 / 序列 | CloningWizard |
| Insert at position | 插入位置 | CloningWizard |
| Left / Right homology arm | 左 / 右同源臂 | CloningWizard / CloningSetupPanel |
| Simulated construct | 模拟构建体 | CloningWizard |
| Create construct | 创建构建体 | CloningWizard |
| Simulated, not verified | 模拟结果——未经实验验证 | CloningWizard notice |
| Read name | 读段名称 | SequenceVerificationDialog |
| DNA sequence | DNA 序列 | SequenceVerificationDialog |
| Run verification | 开始比对 | SequenceVerificationDialog |
| Read coverage / Matches / Substitutions / Indels | 读段覆盖率 / 匹配数 / 替换 / 插入缺失 | SequenceVerificationDialog |
| Differences | 差异 | SequenceVerificationDialog |
| Copy report | 复制报告 | SequenceVerificationDialog |
| Open trace alignment | 打开色谱比对 | SequenceVerificationDialog |
| Top hits | 主要命中 | ValidationDetails |
| Accession / Organism / Score / E-value / Identity / Mismatches | 登录号 / 物种 / 得分 / E 值 / 一致性 / 错配 | ValidationDetails |
| Verify against sequencing read | 与测序读段比对 | SequenceToolsMenu |
| Auto-annotate common features | 自动注释常见特征 | SequenceToolsMenu |
| Find open reading frames | 查找开放阅读框 | SequenceToolsMenu |
| New sequence from selection | 从选区新建序列 | SequenceToolsMenu |
| Design Agent | 设计 Agent | AgentPanel 标题 |
| New task | 新任务 | AgentPanel |
| New molecular design | 新建分子设计 | AgentPanel welcome |
| Example tasks | 示例任务 | AgentPanel welcome |
| Conversation | 对话 | AgentPanel |
| Artifacts | 产物 | AgentPanel |
| Download | 下载 | AgentPanel 产物 |
| Send / Stop | 发送 / 停止 | AgentPanel composer |
| Run failed | 运行失败 | AgentPanel error |
| Retry run | 重试运行 | AgentPanel error |
| Apply to vector | 应用到载体 | PatchPreview |
| Reject | 拒绝 | PatchPreview |
| Patch applied | 补丁已应用 | AgentPanel revert node |
| Revert last Agent change | 撤销上一次 Agent 更改 | AgentPanel |
| Proposed diff | 建议更改差异 | PatchPreview diff 轨道 |
| Kind / Where / Reason | 类型 / 位置 / 原因 | PatchPreview 操作表 |
| I acknowledge these warnings | 我已了解这些警告 | PatchPreview |
| Apply as new file | 复制为新文件并应用 | PatchPreview（保留原文既有） |
| Circular / Linear | 环状 / 线性 | DocumentToolbar / Sidebar / OveEditorHost |
| Confirm plan and generate preview | 确认计划并生成预览 | AgentPanel 计划节点 |
| Ready to compare | 准备比对 | SequenceVerificationDialog |
| Aligning read | 正在比对读段 | SequenceVerificationDialog |
| Thinking… / Running tools… / Validating… | 思考中… / 运行工具… / 验证中… | AgentPanel 工作指示器 |

---

## 2. 保留英文的术语（技术/物种专有名词，不译）

以下术语在任何界面均**保留英文**（或英文 + 中文括注），避免歧义：

- 文件格式 / 品牌：`GenBank`、`FASTA`、`SnapGene (.dna)`、`.ab1`、`pUC19`
- 分子生物学方法：`Gibson`、`Golden Gate`、`Type IIS`、`PCR`、`inverse PCR`、`DNA`、`RNA`、`sgRNA`、`siRNA`、`RT-qPCR`、`ORF`、`CDS`
- 度量单位：`bp`、`nt`、`Tm`、`GC`、`°C`
- 限制酶名：`BsaI`、`EcoRI`、`BamHI`、`SapI` 等（一律原样）
- 登录号 / 物种学名：`NM_002046`、`Homo sapiens`、`C57BL/6` 等
- 产品名：`GeneCode`、`Agent`（组合译「设计 Agent」）、`pUC19`
- 后端字段名 / 工具名：`fragment_primers`、`backboneLinearization` 等（代码层，不属 UI）

**注意**：`Agent` 单独出现时保留英文（Agent 面板、Agent 服务、Agent 更改），与中文组合时用「设计 Agent / Agent 服务 / Agent 更改」。

---

## 3. 后端 error code 与 UI 文案解耦（契约）

后端（`server.py`）与前端（`src/agent/service.ts`）之间的错误传递**以 HTTP 状态码 + 结构化 status 字段为契约**，UI 文案不得依赖匹配后端报错字符串：

1. **HTTP 状态码即 error code**：`400`（坏请求）、`401/403`（未授权，A-API-001 token 握手）、`404`（未知路由）、`413`（请求体过大）、`429`（限流）、`500+`（上游失败）。前端 `AgentServiceError` 携带 `status` 字段（`service.ts`），连接性判断用 `status` 而非解析文本。
2. **运行状态用结构化字段**：`launch.status`（unavailable/…）、`runLog[].status`（running/completed/failed/error）、`agentRun.status`、`plan[].status`、`validationStatus`。UI 决策（如 AgentPanel 的失败横幅、重试按钮、revert 节点）全部基于这些字段。
3. **错误消息仅为展示载荷**：后端返回的 `error` 字符串（中文）直接展示给用户；前端不 `if (message.includes(...))` 分支。若未来要区分错误类型，新增结构化字段（如 `error_code: "LLM_RATE_LIMIT"`），不解析文案。
4. **新增文案约定**：新增后端报错一律中文；新增 UI 文案一律走本表译名。

---

## 4. 维护约定

- 新增组件文案前先查本表；未收录的术语按「中文 + 括注英文」首次出现、之后单用中文。
- 修改本表后应全库搜索旧译名（`grep`）确认无残留。
- 测试查询（`getByText`/`getByLabelText`）跟随 UI 文案同步更新，不反向固化英文。
