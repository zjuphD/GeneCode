# GeneCode「苹果味」重构设计方案

状态：待评审 → 通过后执行
日期：2026-08-22

## 0. 北极星

**让 GeneCode 长在 macOS 上。** 原生窗口材质、系统字阶、单一蓝色强调、工作区永远实色稳定。

参考系：Parcel（材质）、Apple Notes/Reminders（侧栏）、现有 Benchling 式布局密度。

明确不做：全窗玻璃化（专业工具的序列数据和流式输出不能漂在雾里）、渐变按钮、发光描边。

## 1. 材质系统 —— 三层

| 层 | 材质 | 应用区域 |
|---|---|---|
| **Vibrant** | macOS 原生窗口模糊 + CSS `rgba` 半透明面 | 文档标签条、顶栏、Sidebar、设置面板壳 |
| **Solid** | 实色 surface | 菜单工具栏行、OVE 视图工具栏、Agent 面板 |
| **Lightbox** | 纯白 | OVE 画布（现状不动） |

降级矩阵：

| 环境 | 表现 |
|---|---|
| macOS + 毛玻璃主题 | 真 vibrancy（桌面透出模糊） |
| Windows | 二期接 mica/acrylic，一期自动落回实色浅色 |
| 浏览器 dev 预览 | 无 Tauri invoke，CSS 半透明退化为浅灰实色 |

## 2. Token 设计

新增第四主题 `"glass"`，作为**浅色的变体**：继承 light 全部语义色，仅替换 shell 表面为 alpha 材质。

```css
[data-theme="glass"] {
  --color-bg: transparent;              /* 交给 vibrancy */
  --color-surface: rgba(246, 248, 250, 0.72);
  --color-surface-raised: rgba(255, 255, 255, 0.82);
  --color-bg-subtle: rgba(17, 33, 51, 0.05);
  /* 文字/边框/accent 全部继承 light 值 */
}
.shell-vibrant {                        /* 仅标签条/顶栏/Sidebar 挂 */
  -webkit-backdrop-filter: saturate(1.8) blur(22px);
  backdrop-filter: saturate(1.8) blur(22px);
}
```

MUI 侧：glass 复用 light 主题（paper 保持白色实体）。

## 3. 组件处理地图

| 区域 | 处理 | 备注 |
|---|---|---|
| 文档标签条 | vibrant，active 标签白卡浮起 | Parcel 列表同款 |
| 顶栏 | vibrant，边框改发丝线 | |
| 菜单工具栏行 | **实色不动** | 高频数据操作区要稳 |
| OVE 视图工具栏 | **实色不动** | 同上 |
| Sidebar | vibrant | 特征轨道列表照旧 |
| Agent 面板 | **实色不动**，顶部发丝线 | 流式输出不能飘 |
| 设置 Drawer | vibrant 壳 + 白内容区 | |
| 对话框 | 白卡、圆角 10、双层柔影 | 苹果弹窗感 |
| OVE 画布 | 纯白灯箱 | 现状不动 |

## 4. 排版与细节

- 字体：系统栈不变；标题字重 650 → 590（semibold，更苹果）
- 圆角：卡片维持 6；弹窗/外壳容器 10
- 投影语言：双层柔影 `0 1px 2px rgba(16,24,32,.06), 0 8px 24px rgba(16,24,32,.08)`
- 密度：行高、间距全部不动（科研工具红线）

## 5. 技术实施清单

1. `src-tauri`：加 `window-vibrancy` crate（Tauri v2 兼容）；`set_glass(enabled)` command；tauri.conf 窗口支持透明
2. `ui/themePreference.ts`：`ThemePref` 增加 `"glass"`；`apply()` 时 invoke 开关窗口效果（Tauri 环境 detect，浏览器 no-op）
3. `App.css`：`[data-theme="glass"]` token 组 + `.shell-vibrant` 材质类；挂到标签条/顶栏/Sidebar
4. `ui/theme.ts`：glass 复用 light MUI 主题
5. `SettingsPanel.tsx`：外观四档（浅色 / 深色 / 毛玻璃 / 跟随系统）
6. 回归：暗色主题行为完全不变

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| vibrancy 仅 macOS | 非 macOS 自动落回实色浅色（同一 token，无 blur） |
| 透明面上文字发虚 | `saturate(1.8)` 补偿色彩；blur 只限侧栏/顶栏小面积 |
| 深色壁纸下浅玻璃对比不足 | 文字用实色 ink；验收时深/浅壁纸双测 |
| webview 透明引发渲染异常 | vibrancy 由 command 显式开关，出错可一键回实色 |

## 7. 验收清单

- [ ] 四档主题循环切换，无残留 class / 窗口效果
- [ ] 深、浅两种桌面壁纸上侧栏文字对比度达标
- [ ] 图谱 / 序列视图回归截图与现状一致
- [ ] 浏览器预览模式正常（invoke 被 guard）
- [ ] 构建全绿
