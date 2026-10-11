# 舞厅底图与字体

## 底图

`public/assets/ballroom-board.png` 使用内置 imagegen 生成，没有复制商业桌游插画。
它只作为装饰底图：图上的纹理、柱子、吊灯构图不提供任何新的可交互实体、路径或物理规则。
可点击地点由真实公开会话的已知地点和 offer 决定。

生成提示词：

```text
Use case: stylized-concept. Asset type: top-down board-game room background for an interactive browser tabletop, not a UI mockup. A wide rectangular frozen palace ballroom, strict orthographic overhead view, a beautifully hand-painted board-game tile on a nearly black neutral surround. Icy silver-blue marble floor, subtle geometric inlaid floor pattern, snow dust along perimeter walls, four small decorative pillars against the walls only, a delicate suspended brass chandelier seen from directly above at the center left with pale amber crystalline highlights. The room floor must be bright and readable and mostly empty, with generous clear space for UI location tokens. Restrained high-detail painted illustration, warm brass against glacial cyan and white, sophisticated adventure tabletop art. No characters, no writing, no numbers, no labels, no logo, no UI, no grid lines, no visible doors or exits, no additional furniture or interactable props. Landscape composition approximately 3:2. Edges fully within frame. This is decorative backdrop only, actual gameplay locations overlaid by code.
```

## 字体

`public/assets/m1-noto-sans-sc-fallback.woff` 的内嵌名称为 **Noto Sans CJK SC**，
版本为 **2.004**（`hotconv 1.0.118;makeotfexe 2.5.65603`），不是已确认的 Noto Sans SC 网页子集。
字体内嵌版权为 Copyright 2014-2021 Adobe；文件字节保留源码快照中的版本。
上游：[Noto Sans CJK 2.004](https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004)，
许可：[SIL OFL 1.1](https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE)。
`public/assets/OFL-NotoSansSC.txt` 和 `m1-noto-sans-sc.LICENSE.txt` 保留完整许可正文。
已有来源未记录该 WOFF 的转换命令或子集参数，不推定它与上游下载文件逐字节一致。
字体加载失败时使用系统中文字体，不影响规则或会话。

## 图标

工具图标使用 `lucide-react`，不手绘替代图标。其第三方许可由 npm 依赖保留。

## 场景与地图

- 当前十一张 V3 场景：[来源、完整提示词与 CC BY-SA 4.0](../public/assets/SCENE_BACKGROUNDS_V3.md)。
- 地图：[原图与 V1 改编许可](../public/assets/PALACE_MAP_LICENSE.md)、[V3 编辑记录](../public/assets/MAP_ART_V3.md)。
- 旧场景生成提示：[来源 JSON](../public/assets/scene-art-provenance.json)。旧 PNG 保留原字节，不作为当前备用图片。
- [素材与提示词 SHA-256](../public/assets/provenance-hashes.json)记录原始提示及去除本机路径后的公开提示摘要。

路径使用逻辑来源名称，不代表原始 PDF、草图或生成中间图也包含在本仓库。
V3 场景和两代地图采用各自说明中的 CC BY-SA 4.0；舞厅底图及未另标注的原创表现素材保留权利，
不以生成工具来源代替复用授权。历史立绘仅保留提示词，图像不在快照中。
