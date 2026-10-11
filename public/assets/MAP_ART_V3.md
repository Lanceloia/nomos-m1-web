# M1 地理建筑底图 V3

## 资产范围

`public/assets/palace-geographic-v3.png` 由 V1 底图一次参考编辑生成，保留原有归一化叠层坐标。
材质和画风更新不改变世界拓扑。原始与公开提示词摘要见 `provenance-hashes.json`。

## 原作与许可

原作：**Pepijn 与 Willem-Jan**，*Thawed Through the Everflame*，1.1，2025；
参考标识 **ThawedThroughEverflame1.1**。
[原作者发布页](https://itch.io/jam/one-page-dungeon-contest/rate/3717370)；
原作参考标识：`original-source/ThawedThroughEverflame1.1.pdf`。
署名许可来源标识：`original-source/attribution-and-license`。

新地图及**本说明**沿用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。
这是原作区域地图的美术改编：通过现有已去人物、事件与箱子的底图，编辑材质、绘画细节与冷蓝灰白/少量金色画风。
与场景背景的新绘不同，本图明确以已有底图像素与结构作为编辑参考。
不表示原作者审核或认可新绘画；许可仅适用于本图及相关资产说明，不更改应用、引擎或其他代码权利。

## 原图与逻辑生成来源

- 编辑参考：`public/assets/palace-geographic-v1.png`。
- 原图实际尺寸：**1051 x 1496，8-bit RGBA、非交错 PNG**，不是实际 900 x 1280。
- 页面逻辑坐标：**900 x 1280**；必须按原有归一化相对位置使用，不改地点中心或路线点。
- 原图 SHA-256：`07ec8cafc3fe94fe9db7310c900a5087ffada2972ae74c5750d9bc90c90d35b3`，施工后未变。
- 生成来源标识：`generation/palace-geographic-v3/final.png`。
- 项目副本：`public/assets/palace-geographic-v3.png`，直接复制工具 PNG，未裁切、变形、缩放或重编码。
- 新图实际尺寸：**1051 x 1496，8-bit RGBA、非交错 PNG**。
- 新图 SHA-256：`07ca8439cda588bc315c796029f9803e2bccfa64d60032d275ca3340d52cc315`。
- 调用：内置 `image_gen`；`referenced_image_paths` 仅包含原图；`transparent_background=true`，保留 RGBA 输出。
- 未使用 CLI/API/网络 fallback、Python 绘图、拼图或 atlas。

## 结构检查与限制

原图与选定图均已 view_image。目视比较上端窄桥、柱厅、右上平台、中段各楼层、门洞、
连接台阶、下端监牢结构和右侧塔室，主要区域位置、轮廓与相对尺度沿用原图，未新增区域、桥支路或角色。
只对冻结石材、画笔细节与非发光金色装饰做风格统一；空建筑状态保持，图上没有文字、节点或 UI。

生成绘画不是几何重绘保证：部分描边厚度和局部纹理不同，透明边缘以及下部台阶旁的空隙可见青色残留。
选定图保留现有坐标叠层。
不声称逐像素轮廓相同，也不把地图绘画细节转为新地理或互动合同。
公开快照没有重做绘图、坐标或页面验证。

## 完整编辑提示词

```text
Use case: style-transfer.
Asset type: ONE transparent-background portrait PNG EDIT of the supplied existing palace geographic map; NOT a new map or new layout.
Reference/edit target: public/assets/palace-geographic-v1.png. Existing file is 1051x1496 RGBA; logical site SVG coordinates are 900x1280. Preserve original portrait aspect ratio and original normalized geometry, placement, camera and image margins exactly; pixel count may differ.
PRIMARY INVARIANT: retain EVERY existing region/building floor-plane boundary, every wall outline and thickness, every door-opening silhouette, every column location/scale, every staircase and step direction, the upper-left narrow bridge and its exact outline, every vertical structural connection and both right-hand towering edges. All vertices and features stay at the SAME normalized x/y positions and SAME relative scales. Do NOT shift, widen, shorten, rotate, recenter, crop, rearrange, simplify or invent any geography. Existing top blank padding and bottom spacing remain. This image is a visual underlay for fixed-coordinate overlays; changed geometry is unacceptable.
Edit ONLY texture, brushwork and palette, without moving edges. Replace flat cyan comic fill with fine crisp painterly ice-blue/gray-white frozen stone, restrained nonluminous antique-gold architectural accents, softly modeled frost and clear carved masonry surfaces matching the new palace room backgrounds. Retain the exact existing isometric cutaway view and original empty architectural state. Keep all floors clear and empty, all reference doors and bridge shapes intact. Retain the existing lower-left barred-cell architectural walls, central room planes, upper columned hall, upper-right platform, lower/right tower chamber, connecting steps and bridge precisely where the reference placed them, not a redesign.
Transparency: preserve genuine transparent exterior around architecture, including all existing gaps between planes; no solid black/white/sky background, no scenic vignette. Do not add a shadow extending silhouette or perspective extrusion outside current outlines.
Avoid: ANY text, letters, labels, numbered rooms, nodes, map pins, UI, routes drawn over map, occupants, characters, animals, statues, furniture, boxes, chests, coins, events, flames, glow, added door, bridge branch, changed stairs, added room, widened paths, new terrain, border, watermark. Repaint materials within original outlines ONLY.
```
