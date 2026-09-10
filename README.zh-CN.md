# genecode：分子生物学智能体

[English](README.md) | **简体中文**

> 将序列编辑、专业计算工具与 AI 对话放在同一个工作台，让智能体围绕当前序列和选区协助工作，并保留可查看的执行步骤与修改记录。

[![在线演示](https://img.shields.io/badge/在线演示-打开_GeneCode-6f56d9)](https://genecode-agent.pages.dev/)
[![CI](https://github.com/zjuphD/GeneCode/actions/workflows/ci.yml/badge.svg)](https://github.com/zjuphD/GeneCode/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/zjuphD/GeneCode?style=flat)](https://github.com/zjuphD/GeneCode/stargazers)
[![Tauri + React](https://img.shields.io/badge/Desktop-Tauri_%2B_React-2472a4)](https://tauri.app/)

**[体验在线 Demo](https://genecode-agent.pages.dev/)** · [反馈问题](https://github.com/zjuphD/GeneCode/issues)

<p align="center">
  <a href="https://genecode-agent.pages.dev/">
    <img src="docs/assets/genecode-agent-workflow-preview.gif" alt="GeneCode 工作流演示：提交任务、读取当前序列、查看工具执行步骤" width="100%">
  </a>
</p>

<p align="center"><sub>提交序列分析任务 → 智能体读取当前序列 → 查看工具执行过程与结果。</sub></p>

## GeneCode 解决什么问题？

分子生物学工作往往需要在序列编辑器、计算工具和聊天窗口之间反复切换。GeneCode 把这些环节放到一个工作台：你可以查看和编辑序列，让智能体结合当前文档与选区调用工具，再检查结果与修改。

模型负责理解任务与组织对话，具体序列计算由程序工具完成。模型回答不等同于实验结论，重要结果仍需人工核对和实验验证。

## 核心能力

- **序列编辑与可视化**：环形、线性、序列及双视图，支持选区操作。
- **常用编辑工作**：特征注释、引物相关操作、限制性酶切位点查看。
- **文件与历史**：GenBank / FASTA 导入、文档历史及可检查的修改记录。
- **上下文感知智能体**：结合打开的序列和选区对话，展示工具执行步骤。
- **专业工具工作流**：提供分子克隆、RT-qPCR、sgRNA、siRNA 与点突变相关工具入口。
- **本地优先**：支持本地运行与部署，可选接入自定义 OpenAI-compatible 模型服务。

本地部署本身无需购买 GeneCode 订阅；外部模型 API、云主机或其他第三方服务可能收费。不接入模型时可使用本地计算工具，但不等同于具备完整的智能体对话能力。

## 快速体验前端

```bash
git clone https://github.com/zjuphD/GeneCode.git
cd GeneCode/molecular-design-studio && npm install
npm run dev
```

打开 `http://127.0.0.1:1420`。以上仅启动前端；完整本地 Agent 需要按下方说明启动后端，或使用桌面开发模式。

## 环境要求

- Node.js 22+
- npm 10+
- Python 3.11+
- 桌面应用开发另需 Rust stable 与对应平台构建工具

## 完整浏览器开发模式

在仓库根目录启动后端：

```bash
# 终端 1；dev-token 仅用于本机开发
GENE_CODE_API_TOKEN=dev-token python3 server.py --port 8000
```

另开终端启动前端，使用相同的本地 API token：

```bash
# 终端 2
cd molecular-design-studio
VITE_AGENT_API_TOKEN=dev-token npm run dev
```

然后访问 `http://127.0.0.1:1420`。本地 API token 用于前后端鉴权，不是模型服务商的 API 密钥。请保持服务绑定本机地址，不要将开发 token 用于公开部署。

## 桌面开发

```bash
git clone https://github.com/zjuphD/GeneCode.git
cd GeneCode/molecular-design-studio
npm install
npm run tauri:dev
```

桌面应用通过 Tauri 启动或连接本地 Agent 服务。更多工程说明见 [桌面前端 README](molecular-design-studio/README.md)。

## 接入自定义模型

支持 OpenAI-compatible 接口。浏览器开发模式下，在启动后端的同一终端设置：

```bash
export AGENT_LLM_ENABLED=1
export AGENT_LLM_API_KEY="你的模型服务 API 密钥"
export AGENT_LLM_MODEL="你的模型名称"
export AGENT_LLM_BASE_URL="https://provider.example/v1"
GENE_CODE_API_TOKEN=dev-token python3 server.py --port 8000
```

请替换占位地址、模型名称和密钥。不同模型的接口兼容性、限额与响应速度可能不同。

**不要把模型密钥放进前端源码、截图或 Git 提交，也不要提交 `.env` 文件。** 在线 Demo 的展示效果不代表你的本地模型连接已经配置成功。

## 验证与测试

```bash
cd molecular-design-studio
npm run typecheck
npm run lint
npm test -- --run
npm run build
npm run build:agent-sidecar
cargo check --manifest-path src-tauri/Cargo.toml

cd ..
AGENT_LLM_ENABLED=0 python3 -m unittest discover -s tests -p "test_*.py"
```

CI 状态可通过页面顶部徽章查看。单元测试或构建通过，不代表外部模型、数据库服务和所有实验工作流均已通过端到端验证。

## 仓库结构

```text
.
├── molecular-design-studio/   # React、Tauri 与序列编辑器前端
├── server.py                  # 本地 Agent / API 入口
├── server_pkg/                # Agent 与专业计算实现
├── tests/                     # Python 回归与安全测试
└── .github/workflows/ci.yml   # 前后端持续集成
```

根目录的 `index.html` 和 `assets/` 保留了由 `server.py` 提供的 Primer Design Studio 浏览器兼容页面。

## 当前边界

- 项目持续迭代中，尚不等同于成熟商业序列编辑器的完整功能覆盖。
- 当前并非通用网页搜索助手；数据库联网查询和普通模型回答需要区分。
- 远程模型、数据库检索与比对依赖网络及上游服务，失败时应检查具体错误，不应将失败解释为已完成验证。
- 序列修改、引物和其他设计结果应结合原始数据及实际实验条件复核；建议保留原始文件副本。

欢迎通过 [GitHub Issues](https://github.com/zjuphD/GeneCode/issues) 提交问题、使用反馈和功能建议。反馈时请附版本、复现步骤与脱敏截图，不要公开 API 密钥或未授权的研究数据。
