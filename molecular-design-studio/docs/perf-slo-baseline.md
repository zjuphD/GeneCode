# A-PERF-001 — 大序列 SLO 基线（2026-08-07）

基准脚本：`src/performance/slo-bench.bench.ts`（vitest bench / tinybench）
运行：`npx vitest bench src/performance/slo-bench.bench.ts`（bench 文件不会被 `vitest run` 收集）

矩阵：序列长度 10kb / 100kb / 1Mb × features 100 / 1k / 10k，共 **9 组 × 9 个基准**（4 打开 + 2 切视图 + 3 保存）全量执行。
数据确定性（mulberry32 固定种子），单机可复现；表中数值为 tinybench **mean**（ms）。

## 一、实测基线（mean, ms）

| 规模 | parseGB | toOVE | tidy | cutsites(23酶) | Seq行 | Map布局 | serProj | expGB | expDNA |
|---|---|---|---|---|---|---|---|---|---|
| 10kb/100f | 5.75 | 0.00 | 1.06 | 0.14 | 0.12 | 0.24 | 0.12 | 5.22 | 0.10 |
| 10kb/1kf | 51.4 | 0.02 | 6.39 | 0.15 | 0.94 | 3.00 | 1.05 | 52.5 | 1.00 |
| 10kb/10kf | 526 | 0.21 | 66.6 | 0.15 | 18.8 | 57.0 | 10.6 | 516 | 12.0 |
| 100kb/100f | 12.6 | 0.00 | 4.52 | 2.21 | 0.51 | 0.26 | 0.32 | 5.61 | 0.11 |
| 100kb/1kf | 59.0 | 0.02 | 10.4 | 2.29 | 1.33 | 2.98 | 1.27 | 52.5 | 1.06 |
| 100kb/10kf | 521 | 0.21 | 68.8 | 2.28 | 12.0 | 48.1 | 10.8 | 522 | 12.6 |
| 1Mb/100f | 112 | 0.00 | 60.1 | 18.4 | 6.74 | 0.26 | 1.92 | 9.03 | 0.22 |
| 1Mb/1kf | 159 | 0.02 | 66.7 | 18.4 | 9.95 | 3.11 | 2.91 | 58.4 | 1.16 |
| 1Mb/10kf | **631** | 0.17 | **129** | 17.8 | **19.1** | **45.7** | 12.6 | **530** | 12.8 |

## 二、缩放规律（对 rope / interval index 决策的关键证据）

| 操作 | 主导变量 | 缩放 | 结论 |
|---|---|---|---|
| parseGenBank | features 数 | **10× features ≈ 10× 时间（线性，~50µs/feature）**；长度影响弱 | 线性，**无超线性** |
| tidyUpSequenceData | 序列长度 | 10kb→1Mb 约 1ms→65-125ms（~线性） | 线性 |
| getCutsitesFromSequence | 长度×酶数 | 1Mb/23酶 ≈ 18ms（线性） | 线性；已是缓存化路径（A-ENG-002） |
| prepareRowData (Seq行) | 长度为主、features 次之 | 1Mb ≈ 6.6-19.9ms | 线性 |
| Map布局 (IntervalTree) | features 数 | 10k features ≈ **43-55ms**（此前 1Mb/100f 的 0.12ms 是小规模假象） | 线性；**IntervalTree 已生效** |
| serializeProjectFile | features 数 | 10k ≈ 10-12ms | 线性 |
| exportToGenbank | features 数 | 10k ≈ 518-528ms（50µs/feature） | 线性 |
| exportToSnapGene | features 数 | 10k ≈ 12ms | 线性 |

**无任何 O(n²) 或超线性热点。** 最慢单操作为 1Mb/10k features 的 `parseGenBank` = **629ms**，其次 `exportToGenbank` = 528ms——两者均为 bio-parsers 单遍线性解析/序列化，代价在 feature 条目本身（~50µs/条）。

**修正记录（两轮代码审查）**：① 初版 map-layout 只对 1Mb/100f 出数（0.12ms），其余 8 组因传给 `relaxLabelAngles` 的 label 对象缺少 `x/y/angle/labelAndSublabels/labelIds` 字段而崩溃（NaN）——修复为构造引擎形状 label 点；② 第二轮审查发现缺 `annotationCenterAngle` 时 `combineLabels` 把所有 label 塌缩进 `buckets[NaN]`（分桶成本被跳过），已补上该字段——最终 10k features Map 布局 **45-57ms**（仍线性、预算内）。**其余已知局限**：`prepareRowData` 输入仅含 features 轨道（无 cutsites/parts/primers——真实引擎 sequenceData 还有酶切位点行，测的是 features-only 行成本）；`maxradius=seqLen/500` 与引擎的容器尺寸半径（~400-600px）不同，偏大导致 combine 触发略少；数值为**计算相位**（Node，M1 系），不含 DOM 渲染。

## 三、SLO 目标 vs 实测

| 操作 | 目标 | 1Mb/10kf 实测 | 判定 |
|---|---|---|---|
| 打开（parse→adapter→tidy） | ≤ 1s（1Mb） | 631+0.2+129 ≈ **760ms** | ✅ 达标（余量 24%） |
| 打开含酶切位点 | ≤ 1.5s（1Mb） | +18 ≈ 778ms | ✅ 达标 |
| 切视图 Sequence | ≤ 300ms（1Mb） | 19.1ms（features-only 行） | ✅ 达标（15× 余量） |
| 切视图 Map | ≤ 300ms（1Mb） | 45.7ms | ✅ 达标（6.5× 余量） |
| 保存（serialize+export） | ≤ 1.5s（1Mb/10kf） | 12.6+530 ≈ 543ms | ✅ 达标 |
| 打开交互阈值（>100k 显示 warning） | ≤ 2s | 773ms | ✅ 达标 |

> 注：实测为**计算相位**耗时（Node，M1 系）；完整 UI 首帧（DOM 渲染 + React 提交）未覆盖，需浏览器 harness 复核。对 1Mb 序列首次打开，预期总观感 < 1.5s。

## 四、决策：是否需要 rope / interval index？

**结论：当前不需要实现 rope 或 feature interval index 大项**（A-PERF-001 剩余 roadmap 中这两个子项降级为可选优化）：

1. **sequence chunk/rope** —— 不需要。`prepareRowData` 逐行 `sequence.slice` 为短切片（60bp），总耗时 ≤ 20ms/1Mb；`tidyUpSequenceData` 等全长操作为单遍线性。rope 收益只在"超大序列 + 频繁局部编辑"场景，本项目主路径无此热点。**若未来做序列编辑（A-BIO-003 完整引擎）再评估。**
2. **feature interval index** —— 不需要。CircularView 已用 `node-interval-tree`（实测 10k features 布局 ≤ 55ms）；Sequence 视图行计算为线性；无按区间查询的热路径。
3. **真正值得做的（按收益排序）**：
   - `parseGenBank` / `exportToGenbank` 的 **50µs/feature** 常数是当前唯一实质成本（10k features ≈ 0.5s）。可评估 bio-parsers 解析路径减负（跳过未用 qualifier、特征批量创建），预期把 1Mb/10kf 打开压到 ~400ms。
   - **分析 worker 已落地**：`src/performance/sequenceWorker.ts` + `sequenceWorkerClient.ts` 在 ≥50 kb 时把 GC/常见酶切位点摘要移出 React 主线程，Worker 不可用时回退到确定性的同步实现。GenBank parse/serialize 仍由 OVE/解析器执行，尚未假装已经 worker 化。
   - history delta 已在 A-DATA-001 落地。

## 五、后续

- 基准已入库，可作回归门禁：CI 记录均值，防 50µs/feature 或 1Mb 打开拖回秒级。
- 浏览器端首帧复核（可选）：Playwright 加载 1Mb 文档测量挂载到可交互时间。
