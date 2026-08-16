# GeneCode Agent Harness

这是 GeneCode Design Agent 的确定性发布门禁。默认不调用大模型 API，而是直接调用
`server.py`，确保规则路由、分子设计算法和安全边界可以稳定复现。

Harness v3 检查：

- 任务路由、缺失参数和多轮上下文
- Tool Registry、风险等级、模式权限与禁止直接写序列
- Plan → Execute 的 run ID、状态、时间线和工具 provenance
- 旧序列计划拦截、Review 模式拦截和重复执行拦截
- RT-qPCR、sgRNA、siRNA、点突变的基础生物学范围
- Gibson、限制酶、Golden Gate 和多片段组装的引物方向与 junction
- 推荐、Final Review、下单表、风险报告和 protocol 产物协议

运行：

```bash
python3 tests/run_agent_harness.py
```

通过真实本地 HTTP API 运行同一套场景：

```bash
python3 tests/run_agent_harness.py \
  --transport http \
  --base-url http://127.0.0.1:8000
```

只跑单个用例：

```bash
python3 tests/run_agent_harness.py --case cloning_gfp_missing_insert
```

输出：

- `tests/reports/agent-harness-report.json`
- `tests/reports/agent-harness-report.html`

完整运行会额外检查运行时 Tool/Mode 合同。报告包含 case 分组、check 分组、
Harness schema 版本、artifact contract 版本和是否通过发布门禁。

这套确定性 Harness 不替代联网模型评测。OpenRouter 表达质量、远程数据库可用性和
浏览器视觉回归应作为独立套件运行，避免网络波动污染核心算法门禁。
