# ADR: 酶切位点双链切点坐标约定（A-BIO-002）

- 状态：已接受（2026-08-07）
- 影响模块：`server_pkg/bio.py`（`RESTRICTION_ENZYME_LIBRARY`、`find_restriction_site_hits`、`enzyme_strand_cuts`）、`molecular-design-studio/src/editor/enzyme-data.json`、`tests/test_neb_enzyme_fixtures.py`

## 背景

早期酶库用单一 `cut_index` 表达切点，无法表达 Type IIS 酶的不对称双链切口
（BsaI 的 top 链切 1 nt 而 bottom 链切 5 nt）。A-BIO-002 引入 `cuts_top` /
`cuts_bottom` 双链切点模型；本轮（剩余部分）将其推广到全部 34 个内置酶并
补齐 NEB 权威温度，消除"只有 Type IIS 有双链切点"的不对称。

## 坐标约定

所有切点均为**相对识别位点起点（motif start）的 0-based 偏移**，正向（top
strand, 5'→3'）坐标帧：

| 字段 | 含义 |
|---|---|
| `cuts_top` | top 链切口位置（0-based，相对 motif start） |
| `cuts_bottom` | bottom 链切口位置（0-based，相对 motif start） |
| `optimal_temp` | NEB 推荐孵育温度（°C） |
| `cut_index` | 遗留字段，等于 `cuts_top[0]`（保留兼容） |

### 对称（palindromic）酶 —— NEB 镜像规则

`cuts_top = [cut_index]`，`cuts_bottom = [len(site) - cut_index]`。
这是 Biopython 同一镜像规则：EcoRI `G^AATTC` → top=1, bottom=5（6-1）；
KpnI `GGTAC^C`（3' 粘端）→ top=5, bottom=1；blunt（EcoRV/SmaI/PvuII）
top=bottom=len/2。

### Type IIS（非对称）酶

`cuts_top`/`cuts_bottom` 显式列出且**允许超出 motif 边界**（N1/N5 表示切在
motif 末端之外）：BsaI `GGTCTC` → (7, 11)；BsmBI `CGTCTC` → (7, 11)；
SapI `GCTCTTC` → (8, 11)；BbsI `GAAGAC` → (8, 12)；AarI `CACCTGC` → (12, 16)。

### 反向（bottom-strand 识别）命中

`find_restriction_site_hits` 对 Reverse 方向应用镜像换算
`rel_top = len - fwd_bottom, rel_bottom = len - fwd_top`——与 Biopython 的
scd5/scd3 镜像一致，绝对坐标与 NEB 的 GAGACC(5/1) 布局吻合（见
`tests/test_type_iis_dual_cuts.py`）。

## 权威数据源

- 切点与温度参照 **NEB（neb.com）** 发布数据；例外温度：SmaI 25°C、
  ApoI 50°C、BstYI 60°C、BsaI 50°C、BsmBI 55°C，其余 37°C。
- fixtures 测试 `tests/test_neb_enzyme_fixtures.py` 将 34 个酶的
  `(site, (top, bottom), temp)` 钉死为 NEB 参考值——数据编辑偏离 NEB 即失败。

## 决策

1. 对称酶的双链切点**显式落库**（而非运行时推导），保证 schema 一致性与
   下游消费方（digest、酶切位点扫描）可直接读取，不依赖推导逻辑。
   **行为不变**：显式 `cuts_bottom = len(site) - cut_index` 与旧 fallback
   `pattern_len - fwd_top` 逐位等价，`find_restriction_site_hits` / digest /
   `enzyme_strand_cuts` 输出与补全前一致（328 测试全绿佐证）。
2. 保留 `cut_index` 作为兼容字段（大量既有代码与测试引用），其值恒等于
   `cuts_top[0]`。
3. 前端单一事实源 `enzyme-data.json` 仍是 Type IIS 的权威（A-ALG-002）；
   本轮后端库与 NEB 对齐，两者一致性由 `test_enzyme_data_consistency.py`
   持续校验。

## 后续

- 完整 NEB 全库迁移（>200 酶）时，此坐标约定与 fixtures 模式可直接复用。
- `optimal_temp` 目前仅作为数据字段；后续酶切向导可消费它做反应条件提示。
