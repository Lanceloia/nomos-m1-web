# 冰宫地理小地图：来源与许可

资产：`palace-geographic-v1.png`。
生成日期：2026-10-10。
用途：原有冰宫剖面图的中性地理底图；不是新增世界拓扑或运行时状态。

## 原作与署名

原作：*Thawed through the Everflame*，version 1.1。
作者：Pepijn & Willem-Jan，1pagedungeons.com，copyright © 2025。
来源站点：https://1pagedungeons.com/ 。

原图提取来源标识：
`original-source/everflame-palace-extract.png`。
署名许可来源标识：
`original-source/attribution-and-license`。

原图由用户提供 PDF 的内嵌宫殿插图及透明度 mask 提取。
原作公开获取页：https://1pagedungeons.itch.io/opd-contest-entries 。

原 PDF SHA-256：
`ef3d42cc962eed28e1334a0b75da12cd69d720600b6047c89b6a2e53a9ab9f0e`。

原图 PNG SHA-256（生成前后相同，原图未改）：
`1c271eae8dc43871bb67640d6ce2566bc93d6e243c5e00b3b4f6a51b0e739e31`。

建议随资产保留的署名：
“基于 Pepijn & Willem-Jan 的 Thawed through the Everflame 1.1 宫殿插图，
© 2025，1pagedungeons.com；使用内置 imagegen 做 AI 改编；
CC BY-SA 4.0。”

## 许可与改编声明

原作及本改编资产采用 Creative Commons Attribution-ShareAlike 4.0 International
（CC BY-SA 4.0）：
https://creativecommons.org/licenses/by-sa/4.0/ 。

本图是基于原作的 **AI 改编**，不是未经改动的原图，也不表示原作者认可本改编。
改编目标为移除人物、动物、被冻结个体、宝箱、球囊、魔法物、火焰、祭坛内容
和现场事件，保留静态建筑与原有层级布局；第二轮补回首轮误删的桥端冰脊
与下层入口静态冰墙。未添加文字、标签或 marker。

工具：内置 `image_gen.imagegen`，默认配置，
`transparent_background=true`；未使用 CLI、外部 API 或指定替代模型。
先用 `view_image` 查看原图，生成后再目视检查；最终 PNG 直接复制，
没有后处理改画，也没有改动原图。

## 工件与检查范围

最终资产：`public/assets/palace-geographic-v1.png`，1051 × 1496，
8-bit RGBA PNG。
最终 PNG SHA-256：
`07ec8cafc3fe94fe9db7310c900a5087ffada2972ae74c5750d9bc90c90d35b3`。

PNG alpha 只读检查：1,572,296 像素中，922,420 个完全透明，
2,624 个完全不透明，647,252 个具有部分 alpha；图外包含真实透明区域，
不是绘制的棋盘格或实色背景。

目视检查未见人物、动物、冻结人物图像、宝箱、球囊、火焰、仪式圈、
文字、标签或占位标记；复核上方柱厅六根柱子、原有分层地面、
桥梯、下层房间、冰吧曲形柜台及底部监牢。
上述为原始资产记录的目视和 PNG 检查，本次未新增页面或实玩验证。

生成式编辑会重绘线条，不能保证逐像素配准、精确坐标、房间边界尺寸
或全部细节与原图完全一致；不得从本图反推新的门、通路、身份或世界规则。
该图没有获准替代原作的拓扑权威。
未读取核心代码/测试，未运行测试、Compile、服务或 pytest。

生成中间工件的逻辑标识（不随公开快照分发）：
- 首轮：`generation/palace-geographic-v1/round-1.png`。
- 选定第二轮：`generation/palace-geographic-v1/round-2.png`。

## 第一轮完整提示

输入角色：原图作为 edit target。
参数：`referenced_image_paths` 仅含原图绝对路径；
`transparent_background=true`。

```text
Edit target: the supplied original blue hand-drawn ice-palace cutaway map, not a style reference. Make a subtraction-only cleanup of this EXACT existing geographic map for a real geographic minimap. Do not design a new palace or reinterpret its topology.

PRIMARY INVARIANTS: Preserve the entire original image's portrait composition, viewing angle, relative scale, layer offsets, complete extent and silhouette. Keep every floor footprint, wall outline, partition, existing arched opening, column (same count and original positions), tiled floor line, parapet, staircase, frozen stair/bridge and existing ladder in the SAME original relative position and orientation. Preserve all disconnected and connected architectural parts as drawn. No cropping; no rearranging, room rotation, additional rooms, additional doors, new connections, invented bridges, extra stairs or changes to existing access routes. Inpaint only regions occupied by removable scene content, minimally continuing the adjacent original floor or wall where needed.

ARCHITECTURAL ANCHORS TO KEEP UNCHANGED: the long upper-left diagonal ice bridge leading down curved steps into the upper columned hall; the columned hall's two back columns and four front columns; its offset upper-right crenellated terrace and its existing right-hand descending stair; the broad middle rectangular hall and original surrounding corridors and archways; the left adjacent ice-bar room's architectural curved counter but not its drinks or occupants; the lower central room's footprint and all original wall openings; the original lower-left-to-lower-right sloping walkway and descending stair; the lower-right room's walls, floor and original internal ascending stairs; the lowest central entrance room's footprint and stair toward the bottom-left prison; the bottom-left prison's original partitions, railings and existing ladders. The existing long thin blue vertical architectural edge/drop lines on the right remain in their original positions, without reinterpretation as new bridges. Keep the existing static ice boundary structure by the entrance if it is purely architectural.

REMOVE COMPLETELY: every person, humanoid, animal, monster, ghost, silhouette, body, face, frozen individual and ice block containing a figure throughout ALL floors; all treasure chests, barrels/containers functioning as loot, balloon and its basket, magical objects, fiery orange discs, fire, flames, glowing effects, altar/brazier contents including the large central fiery bowl, ritual/magic rings, puddles related to individuals, glasses and bottles, event props and all depicted ongoing scene events. Remove the detached upper-left person/fire/magic vignette completely, leaving transparent space there; do not turn it into a new building. Remove empty ice blocks that acted only as frozen-person markers. Remove ALL orange marks. No words, numbers, labels, symbols indicating occupants, markers, pins, badges or UI overlays anywhere.

STYLE: Retain the reference's simple crisp blue hand-drawn outlines, pale icy-blue floor fills, thin white original floor grid lines and restrained flat shading. Clear, readable static architectural cutaway, not a cinematic scene, atmospheric painting or photorealistic redraw. Avoid adding decorative ice formations or new objects. Outside the existing architecture use true alpha transparency, not a checkerboard drawn into the image, black fill, glow or scenery. Floors/walls remain legible and filled, not erased to transparency. Output a complete neutral unlabelled empty palace geography faithful to the input, with no visible characters or event/loot content.
```

## 第二轮完整提示

输入角色：第一轮结果作为 edit target，原图作为建筑参照。
参数：`referenced_image_paths` 依次包含第一轮结果绝对路径和原图绝对路径；
`transparent_background=true`。

```text
Image 1 is the edit target: the already-cleaned neutral blue ice-palace geographic cutaway on true transparency. Image 2 is the original palace illustration, used ONLY as an exact architectural reference, NOT to reintroduce any people, animals, contents or events.

Make ONLY TWO localized architectural restorations to Image 1, with every other part of Image 1 unchanged:
1. Restore the original thin irregular icy transverse rim/ledge across the far upper-left end of the long diagonal upper ice bridge. In Image 2 this irregular pale-blue ridge runs to the left and up-right from the bridge's upper end, below the detached fire/person vignette. Restore that ridge in its original relative position and footprint, using the same quiet blue lines. The detached fire/person/magical vignette stays completely absent; the space above it remains transparent.
2. Restore the original static jagged upright ice wall panel on the right/front edge of the lowest central entrance room, immediately left of the lower-right balloon room and above/right of the bottom-left prison. In Image 2 it is a pale-blue irregular ice architectural panel with an existing arch-shaped outline, beside the entrance-room floor and near the empty rectangular hole. It contains NO person. Restore the SAME panel silhouette, arch outline, original size, position and orientation, not a newly invented door, room or route. Preserve the existing floor and rectangular hole.

CRITICAL: Do not redraw or reposition the other architecture. Keep all original layered floor footprints, corridors, wall outlines, archways, six upper hall columns, ice-bar curved counter, all existing stairs, bridge, ladders, lower prison divisions and long vertical architectural edge/drop lines unchanged from Image 1. No additions except these TWO static structures that are already visibly present in the original Image 2. No new rooms, doors, stairs, bridges or altered connections. No figures, silhouettes, frozen people, ice-person blocks, animals, treasure chests, balloon or basket, bottles, glasses, magic circles, markers, labels, lettering, symbols, orange marks, flames, glowing effects or altar/brazier contents. This is the same original map emptied of scene contents, not a new world topology. Maintain simple crisp blue hand-drawn outline and pale-blue floor fills, existing white floor grid, full portrait map extent and true alpha transparency outside the structure. No background or fake checkerboard.
```
