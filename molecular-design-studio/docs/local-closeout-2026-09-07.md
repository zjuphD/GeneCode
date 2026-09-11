# 本地收尾与工作流验收 · 2026-09-07

## 结论

本地 Gibson 克隆闭环通过真实浏览器验收：规划、确定性引物计算、补丁预览、确认应用、撤销/重做、GenBank 导出和重新导入均已验证。运行记录及结果附件在后端进程重启后可从新的浏览器会话读取。

当前配置的模型接口在规划与独立连接测试中均出现 SSL EOF 错误；此次设计执行走了应用现有的本地规则回退。因此，本报告不将其记为大模型规划链路通过，也不将该案例外推为“自动识别 CDS 终止密码子并插入 3×FLAG”已通过。

## 收尾内容

- 整理现有主题、桌面玻璃效果、图标、Agent 界面、运行历史和只读 MCP 兼容网关改动。
- 修复 OVE 读取时未提供原始文档的问题：显示颜色、accession/version 与规范文档保持一致，消除正常补丁的错误版本冲突；真实编辑仍触发过期检查。
- 修复只有 ready 计划或零条结果时误显示“结果已生成”的问题。
- 修复运行历史列表没有合并已保存附件、状态更新没有同步 JSON 数据的问题，并提供数据库连接关闭方法。
- 修复运行历史事件未读取后端 output_summary 的问题。
- 修复 GenBank ACCESSION/VERSION 未从第 13 列开始，造成固定列解析器截断元数据的问题。
- 将回复动画测试改为可控计时，避免并行测试下真实定时器导致偶发失败。

## 实际工作流

输入为仓库 `src/fixtures/puc19.gb` 和 `../tests/fixtures/offline_sequences.json` 中的 `default_insert_300`。要求在 M13mp19 注释之后通过 Gibson 插入该 300 bp 测试片段，并提取两端 20 bp 同源臂。此案例用于软件验收，不是经过实验验证的构建方案。

| 检查 | 实测结果 |
| --- | --- |
| 原始载体 | 2,686 bp，环状，8 个注释 |
| 设计 | 5 组候选引物 |
| 插入坐标 | 内部零基坐标 447；新注释 GenBank 448..747 |
| 确认应用 | 2,986 bp，9 个注释 |
| 序列核对 | 与 original[:447] + insert + original[447:] 逐碱基相同 |
| 引物核对 | 5 组的正反向结合区及左右 20 bp 同源臂全部吻合 |
| 撤销/重做 | 2,686 bp / 8 个注释 → 2,986 bp / 9 个注释 |
| GenBank 重新导入 | 2,986 bp、9 个注释、环状、accession/version 保留 |
| 重启恢复 | 同一 run_id、completed 状态、5 个附件可读取；新浏览器会话能预览候选表 |

## 验证记录

- 前端全套：65 个测试文件，1,029 项通过。
- 后端全套：352 项通过，禁用真实模型调用以保证回归测试可重复。
- `npm run build`：lint、TypeScript、生产构建通过；保留既有的大资源包体积警告。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- macOS 本地应用打包通过：`npm run tauri:build -- --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`，包含重新构建的 Python sidecar。输出为 `src-tauri/target/release/bundle/macos/GeneCode.app`。未做公证或原生窗口交互验收。
- 默认自动更新包构建因缺少签名私钥未完成；本地应用打包仅通过命令参数关闭更新产物生成，未改动仓库更新配置。
- 真实浏览器连接的是隔离的本地测试后端，未替换原有 8000 端口服务或修改模型配置。
- 本轮未推送 GitHub，也未部署 Cloudflare。

本地验收产物位于仓库根目录 `output/playwright/`，不作为源代码提交：

- `GeneCode-closeout-Gibson-2986bp-verified.gb`：修正格式后从真实界面导出的文件。
- `closeout-candidates.json`：同一次执行的后端候选结果。
- `verify-closeout.py`：逐碱基、注释及 5 组引物核对脚本。
- `closeout-journal-final.png`：独立浏览器读取持久化结果的界面证据。

较早的 `GeneCode-closeout-Gibson-2986bp.gb` 保留作为修复前诊断产物；使用带 `verified` 后缀的版本。

## 仍有边界

模型接口恢复后需要补测真实 LLM 规划成功路径；当前 SSL 故障也可由独立 HTTP 客户端复现。只读 MCP 网关是有限 JSON-RPC 兼容实现，不宣称完整 MCP Streamable HTTP 支持。未执行 Windows、Linux 或湿实验验收。
