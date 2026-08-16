# 发布流程（A-REL-002 / A-SUPPLY-001）

## 产物清单

一次构建产出三件可验证的发布物（CI 已自动生成并上传为 `genecode-sbom` artifact）：

| 文件 | 内容 |
|---|---|
| `dist/release-manifest.json` | 产物清单：每个文件的 path / size / sha256，附 SBOM 引用 |
| `dist/release-manifest.sha256` | 人类可读的 SHA-256 checksum 侧车文件 |
| `SBOM.cyclonedx.json` | CycloneDX 1.6 软件物料清单（632 组件，从 lockfile 生成） |

生成命令（本地复现）：

```bash
npm run build
npx --yes @cyclonedx/cyclonedx-npm --output-file SBOM.cyclonedx.json \
  --package-lock-only --ignore-npm-errors --output-reproducible
cp SBOM.cyclonedx.json dist/
node scripts/generate-release-manifest.mjs
```

桌面安装包（DMG 等）由 `scripts/add-bundle-manifest.mjs` 追加进同一份
manifest，保证 web bundle 与安装包可被同一份 checksum 校验。

## 供应链治理（A-SUPPLY-001）

- 锁文件 `package-lock.json` 保留 integrity 校验；依赖安装一律 `npm ci`。
- **锁文件只允许官方 registry**：`package-lock.json` 所有 `resolved` URL 已
  归一化到 `https://registry.npmjs.org/`（镜像与官方内容一致，integrity 哈希
  不变）；`scripts/verify-fork-deps.mjs` 在 CI 强制该约束，镜像 URL 或 fork
  依赖规格漂移都会让 CI 失败。
- **npm audit 必须用官方 registry**：默认镜像 `registry.npmmirror.com` 的
  audit endpoint 未实现（404），导致审计静默失败。CI 已固定
  `npm audit --registry=https://registry.npmjs.org --audit-level=high`。
- **fork 依赖治理**：vendored `@genecode/ove` 无自身 lockfile（源码级包，经
  Vite alias 消费），其 47 个 `dependencies` 由根 lockfile 托管——
  `scripts/verify-fork-deps.mjs` 校验每个 fork 依赖版本满足声明的范围
  （含 `npm:` alias 语法），CI 门禁。
- **OSV 扫描**：CI 增加 `google/osv-scanner-action` 扫描
  `package-lock.json` + `src-tauri/Cargo.lock` + `requirements-agent.txt`；
  `Dependabot` 每周自动升级 npm/cargo/pip/GitHub Actions。
- **当前剩余 7 个 advisories（6 moderate / 1 high）**：`lodash`（high，4.17.21
  为最终版，无修复）、`fast-xml-parser` 4.5.7（moderate，仅 XMLBuilder 输出
  侧漏洞，本项目只用解析侧——不可达）、`shortid → nanoid 2.1.11`（moderate，
  shortid 固定传整数长度，漏洞需非整数参数——不可达）。`@teselagen/ui` 的
  nanoid 4.0.2 已通过 `overrides` 降到修复版 3.3.8（8 → 7）。剩余全部来自
  vendored 引擎树，上游无修复或需破坏性升级（`--force` 会升级 React 18 →
  引擎要求的 15-17 造成冲突）。已记录非静默；升级路径见
  `genecode-audit-merged-20260807.md` A-SUPPLY-001。
- CI 审计/OSV 步骤 `continue-on-error: true`（不阻塞发布），但每次运行都留下
  audit 输出与 SBOM 快照，便于追踪。

## 桌面签名与公证（A-REL-002）

### 状态

- ✅ 已落地：CI 干净构建、发布 manifest/checksum/SBOM、release workflow
  （`.github/workflows/release.yml`）、跨平台 sidecar 构建脚本、Windows
  资源映射（`tauri.windows.conf.json`）。
- ⏳ 待证书：Developer ID 签名 + notarization 已在 workflow 中**条件接线**，
  一旦配置 secrets 即生效；本仓库无证书，故从未实际签名过。

### 发布 workflow（.github/workflows/release.yml）

两个触发方式：

1. **正式发布**：推送 `v*` tag（如 `v0.2.0`），且 Apple
   签名/公证与 updater 签名 secrets 完整 →
   构建**签名 + 公证 + stapled** 的 `.app` + `.dmg`，通过
   `codesign --verify --deep --strict` 与 `spctl --assess` 校验后，
   `gh release create` 发布，附 `latest.json`/
   `release-manifest.json/.sha256`/`SBOM`。
2. **演练**：`workflow_dispatch` 手动触发 → 跑同一构建矩阵并上传
   run artifacts，但**永远不创建 GitHub Release**。仓库已配置 secrets 时
   演练产物可能会签名；未配置时为未签名排障产物。

发布 job 会在 tag 推送时校验 tag 版本与 `package.json` / `tauri.conf.json`
的 `version` 字段一致（不一致直接失败）。**缺少完整签名
secrets 的 tag 流程会明确失败，不会静默“成功但未发布”。**

本地可先做完全离线的配置/工件布线演练；它使用临时合成工件，
不访问网络、不读取私钥、不会发布：

```bash
npm run release:rehearse
```

### 平台矩阵（已落地）

| Job | Runner | 产物 |
|---|---|---|
| `macos` | `macos-14`（**arm64**，Apple Silicon） | `.app` + `.dmg` + updater 工件 |
| `macos-intel` | `macos-15-intel`（x86_64） | `.app` + `.dmg` + updater 工件 |
| `windows` | `windows-latest` | NSIS `setup.exe` + MSI + updater `.nsis.zip` |
| `linux` | `ubuntu-latest` | `.deb` + `.AppImage` |

> 注：`macos-14` / `macos-15` 已全部是 Apple Silicon（arm64）runner，Intel
> 机型用 `macos-15-intel` —— 这与早期注释里 "macos-14 是 Intel" 的说法不同，
> 已按 GitHub 官方 runner 参考修正。两个 macOS job 各产一个原生架构包；
> 带 sidecar 的应用不支持 CI 上产 universal（runner 单架构），本机可用下面
> 的 universal 配方产单包。

所有平台产物由独立的 `publish` job（`needs` 四个构建 job）下载后统一
`gh release create`，tag 版本校验也移到 publish。四份
`release-manifest-<platform>.json` + `.sha256` + `SBOM-<platform>.cyclonedx.json`
随安装包一起发布，一份 checksum 校验全部产物。

### Secrets（repo → Settings → Secrets and variables → Actions）

| Secret | 用途 |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application `.p12` 的 base64 |
| `APPLE_CERTIFICATE_PASSWORD` | 该 `.p12` 的密码 |
| `APPLE_SIGNING_IDENTITY` | 签名身份，如 `Developer ID Application: Acme Inc (TEAMID)`（经 `TAURI_SIGNING_IDENTITY` 传入） |
| `APPLE_ID` / `APPLE_PASSWORD` | Apple ID + app-specific password（公证用） |
| `APPLE_TEAM_ID` | 10 位 Team ID |
| `TAURI_SIGNING_PRIVATE_KEY` | updater 私钥内容（`tauri signer generate` 生成） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；无口令时保持空值 |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Windows 代码签名：base64 的 `.pfx` + 密码（可选，缺省时 Windows 产物不签名） |

未显式设置签名身份时，Tauri 会从 keychain 自动发现
`Developer ID Application` 证书；workflow 把 `.p12` 导入一次性
keychain，`tauri build --bundles app,dmg` 在 `APPLE_ID`/`APPLE_PASSWORD`
存在时自动公证并 stapling `.app` 与 `.dmg`。

### 发版步骤（有证书时）

```bash
# 1. 升版本（package.json 与 tauri.conf.json 必须一致）
npm version patch -m "chore: release v%s"
npm run tauri:build -- --bundles app,dmg   # 本地先行验证
# 2. 打 tag 推送（触发 release workflow）
git push origin v$(node -p "require('./package.json').version")
# 3. 等 workflow 发布后核对
#    spctl --assess --type execute GeneCode.app
#    shasum -a 256 -c dist/release-manifest.sha256
```

本地手动构建 + 公证（有证书的 Mac）：

```bash
npm run tauri:build -- --bundles app,dmg
# 公证检查
codesign -dv --verbose=4 src-tauri/target/release/bundle/macos/GeneCode.app
spctl -a -vv src-tauri/target/release/bundle/macos/GeneCode.app
```

### 三平台 sidecar（现状）

- `scripts/build-agent-sidecar.sh` 已支持 macOS / Linux / Windows
  （Git Bash/MSYS）：按平台输出 `agent-server` 或 `agent-server.exe`，
  Windows 下用 `venv/Scripts/python.exe`。
- Rust 宿主（`src-tauri/src/agent_service.rs`）已按平台查找
  `agent-server` / `agent-server.exe`。- `src-tauri/tauri.windows.conf.json` 覆盖 Windows 资源映射（.exe）。**注意**：该文件里的 `"binaries/agent-server": null` 不是笔误——Tauri 平台配置按 JSON Merge Patch（RFC 7396）合并，`null` 用于**移除**基座 `tauri.conf.json` 中不适用于 Windows 的 posix 条目（否则 Windows 构建会因找不到 `binaries/agent-server` 而失败）。**不要删掉这行**。
### 更新器（updater）

已接通 `tauri-plugin-updater`（Cargo.toml + lib.rs 注册 + `plugins.updater`
配置）：

- `bundle.createUpdaterArtifacts: true`，构建时产出签名更新工件
  （macOS `GeneCode.app.tar.gz` + `.sig`，Windows `.nsis.zip` + `.sig`）。
- Windows NSIS 使用 `installMode: currentUser`（更新无需 UAC）。MSI 不被
  updater 支持，仅作普通安装包发布。
- **Tauri v2（2.11.x）没有 `bundle.fileName` 模板**——`tauri.conf.json` 的
  `BundleConfig` 不包含该字段（schema 校验直接拒绝 `fileName`）。因此
  双架构资产名冲突用**构建后重命名**解决：
  `scripts/rename-updater-artifacts.mjs` 把默认的 `GeneCode.app.tar.gz`
  改成带版本与架构的名字，CI 的 macOS（两架构）+ Windows 构建 job 在
  `tauri build` 后各跑一次（Linux AppImage 为 best-effort，产物形态与
  macOS/Windows 不同，可能不进 latest.json）：
  ```bash
  VERSION=$(node -p "require('./package.json').version")
  node scripts/rename-updater-artifacts.mjs src-tauri/target/release/bundle/macos \
    --version "$VERSION" --arch aarch64   # 或 --arch x86_64（macos-intel / windows / linux）
  ```
  产物：`GeneCode-<version>-aarch64.app.tar.gz`（+.sig）与
  `GeneCode-<version>-x86_64.app.tar.gz`（+.sig），两个架构不再同名。
  签名是对文件内容的 Ed25519 签名，**改名不影响签名有效性**（本地已用
  minisign 格式实测：两架构 .sig 的 key id 与 `tauri.conf.json` 的 pubkey
  一致）。注意 `{{arch}}` 是 Rust 目标架构串（`aarch64`/`x86_64`，不是
  `arm64`），`bundle.fileName` 并不存在，别被旧文档误导。
- **端点 fail-closed**：提交的 `tauri.conf.json` 只包含 IANA 保留的
  `https://updates.invalid/genecode/latest.json`，Rust 守卫会将它视为
  “未配置”并禁止前端调用 updater。每个 release build job 都使用
  `scripts/configure-updater-endpoint.mjs` 从 GitHub Actions 提供的
  `GITHUB_REPOSITORY` 生成临时 Tauri overlay；仓库名缺失、为占位符或不合法时
  立即失败。updater 从真实端点拉取 **JSON manifest**（不是压缩包本身）：
  插件解析
  `version/notes/pub_date/platforms`，按 `{os}-{arch}`（如
  `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64-nsis`）找到对应
  平台的 `url` + `signature` 再下载。`latest.json` 由
  `scripts/generate-updater-manifest.mjs` 生成（从各构建 job 重命名后的
  工件 + `.sig` 组装），`publish` job 在发布前用 `github.repository` 作为
  base-url 自动生成并随 Release 一起上传：
  ```bash
  node scripts/configure-updater-endpoint.mjs \
    --repository "<owner>/<repo>" \
    --out src-tauri/target/tauri.release.conf.json
  node scripts/generate-updater-manifest.mjs --version "$VERSION" \
    --base-url "https://github.com/<owner>/<repo>/releases/latest/download" \
    --tauri-config src-tauri/tauri.conf.json \
    --out latest.json src-tauri/target/release/bundle/macos
  ```
  **不要**把端点写成带 `{{current_version}}` 的资产 URL：该变量替换成
  **正在运行的应用的旧版本号**，而资产名里是新版本号——会 404。
  GitHub `releases/latest/download/<文件名>` 会解析到最新 Release 里同名
  资产，所以 `latest.json` 里写 `<version>-<arch>` 文件名即可。manifest
  生成脚本现在默认严格失败：空 `platforms`、缺少必需平台、重复平台、
  工件版本不匹配、签名 key id 与已提交公钥不匹配都会阻断发布。
- **签名密钥边界**：`tauri.conf.json` 只提交 updater **公钥**。CI 需由发布
  负责人提供与其匹配的 `TAURI_SIGNING_PRIVATE_KEY` 和
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，私钥不应写入仓库。本轮离线演练没有读取或
  生成私钥，因此“CI secret 与提交公钥真实成对”仍需在首个受控签名
  构建中验证。
- 前端已接 "检查更新" UI：设置 → 应用更新（`src/components/SettingsPanel.tsx`
  + `src/agent/updater.ts`）。`check()` 有新版时展示版本号/发布日期/包大小并
  触发 `downloadAndInstall()`（进度条实时显示），应用重启完成安装。真实
  端点未注入时（`.invalid` 安全端点由 Rust 命令
  `is_updater_configured` 探测）或浏览器模式时优雅降级提示，不发起无意义请求。
  release workflow 会自动注入当前仓库端点、重命名资产并生成/上传
  `latest.json`，不需要手改提交配置。

### 本地 universal（双架构单包）实测配方

已在 Apple M 机器上完整验证（产物在
`src-tauri/target/universal-apple-darwin/release/bundle/macos/`）：

```bash
# 1. 通用 sidecar：universal2 目标需要 universal2 的 Python（Apple CLT
#    Python 3.9 即是）。注意 lipo 两个 PyInstaller onefile 不可行（自解压
#    偏移会错位，x86_64 片会 dlopen 到 arm64 的 libpython），必须让
#    PyInstaller 直接产出 universal2。
MDS_SIDECAR_TARGET_ARCH=universal2 npm run build:agent-sidecar
file src-tauri/binaries/agent-server   # Mach-O universal: x86_64 + arm64

# 2. 双架构 Rust 交叉编译（rustc 原生跑 arm64、产出 x86_64 代码，无需 Rosetta）
rustup target add x86_64-apple-darwin

# 3. universal 打包（跳过 beforeBuildCommand 以免 sidecar 被原生重建覆盖）
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/genecode.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npx tauri build --target universal-apple-darwin \
  --config '{"build":{"beforeBuildCommand":""}}'
```

验证要点：`file` 应显示 app 主二进制与 `Contents/Resources/agent-server`
均为 universal；两个 slice 都实测过 `/api/health` 返回 200（arm64 原生 +
x86_64 走 Rosetta）。
