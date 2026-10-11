# M1 场景背景 V3：来源、提示词与范围

## 资产范围

包含十一张独立场景背景和一张 V3 地图，场景由 AI 新绘或局部编辑，地图由 V1 底图参考编辑。
部分早期背景补充了装饰陈设，马厩与监牢移除暖光灯具；舞厅不描绘当前吊灯状态。
逻辑来源替代机器路径；原始与公开提示词摘要见 `provenance-hashes.json`。

## 原作、改编与许可

原作：**Pepijn 与 Willem-Jan**，*Thawed Through the Everflame*，1.1 版，2025；
保留参考标识 **ThawedThroughEverflame1.1**。
原作品发布页：[单页作品](https://itch.io/jam/one-page-dungeon-contest/rate/3717370)。
原作参考标识为 `original-source/ThawedThroughEverflame1.1.pdf`；
本次只从作者工作译稿 `original-source/location-descriptions.zh` 的地点描述提取区域建筑气质，不把私密人物、事件或资源写进提示词。
署名与许可由原作者公开发布页及原作署名记录提供。

本批区域改编图以及**本说明**按 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 提供。
改动：根据原作区域概念重新绘制冰封宫殿环境，采用 AI 生成及局部陈设编辑，增加非交互装饰，
不复用原作图页像素，不表示原作者创作、审核或认可这些新绘画。
该许可仅覆盖本说明明确列出的新图与该资产文档，不改变应用、引擎或其他代码的权利。

视觉参考：本树已有 `public/assets/scene-ballroom.png` 与 `scene-corridor.png`，均先通过 `view_image` 查看。
新增图继承灰白石材、冰蓝采光、清晰冻结表面和少量非发光金色装饰。
旧 `scene-ballroom.png`、`scene-corridor.png`、`scene-bridge.png` 未覆写。

## 呈现边界

- 图像仅用于表示玩家当前所处区域；家具、酒瓶、杯、干草、工具、装饰箱架、器皿、毯子、书桌及仪器只作布景。
- 可交互语义仅来自主线程前景图标与正式 offer。背景不授予道路、能力、热量、物品、资源或人物存在。
- 不声明画中陈设是当前可用目标，不声明确切资源数量；装饰箱不是隐藏任务宝箱或奖励证据。
- 不画固定居民、敌人、动物、文字、UI、火焰；仪式圆纹无施法者，塔室陈设无人物身份线索，舞厅不画吊灯状态。
- 塔底螺旋结构及窗外绘画不是路线合同或新地理。应用仅按当前公开 site 映射这些图，不以图片推导私态。

## 生成来源与检查

只使用内置 `image_gen`，一图一调用；没有 CLI/API/网络 fallback、Python 绘图或 atlas。
原生输出为 **1672 x 941，8-bit RGB，非交错、不透明 PNG**；
横向约 16:9，相对比例误差约 0.053%。保留工具输出原字节，未裁切、缩放、拼接或重编码。
生成来源使用逻辑标识，中间草图不随公开快照分发。

9 张最终图均逐张 `view_image` 查看。已进行一次内存内 PNG 完整检查：
签名、chunk 边界/CRC、IDAT 解压、逐行反滤波、非空像素范围、源文件逐字节一致性均通过；
每图完整解码 RGB 字节数 4,720,056。未新增检查脚本或测试入口。
上述为原始资产记录的自查，本次公开快照只核对素材字节和摘要。

| 新资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `public/assets/scene-ritual-v3.png` | 2965159 | `f917b66ffa59e06342c589f16ac8f72649db5f8cebbc58786dac66c54b7dd5bb` |
| `public/assets/scene-treasure-v3.png` | 2967269 | `03fb3af6a820233a8ce7babab3baed86cb2f88ddfb344dabc8c260f264f755a8` |
| `public/assets/scene-icebar-v3.png` | 2922319 | `8dffe61c256eacac886d5c9652b5c6c65f2b1f58554c76650a95eda242fb6495` |
| `public/assets/scene-lower-v3.png` | 3032467 | `959a6ca6608a16f8d055d8d6fdc05020d1ca7d36c53f8fa8074538fe1ee29973` |
| `public/assets/scene-stables-v3.png` | 3088305 | `6ac3e0b6cb6e61b3a52836292ed5e15819af665b8e8615c7cf96fe587ad0725d` |
| `public/assets/scene-prison-v3.png` | 3072711 | `96bab0ca31f5875512ce92b1faadbb61a4bc628ef8e18041540ec490d6bba779` |
| `public/assets/scene-tower-base-v3.png` | 3421768 | `1b06736ecc9d38422d55b40240a301dade2bd559b7b00b0e24f8d72f6dec2b20` |
| `public/assets/scene-tower-top-v3.png` | 3099683 | `1e61b253247c66c871dfac5d2f6f07249a8f5a96e0f2498f03b220ab00a7a570` |
| `public/assets/scene-ballroom-v3.png` | 3419010 | `8bd067d77bd16b2016d14d0568d62c23b5b1f30f7e8dbff93a22d3f583503973` |

## 每图逻辑来源与完整提示词

提示词保留原始指令，仅替换机器路径；中间图不属于公开交付。

### scene-ritual-v3.png

最终输出：`generation/scene-ritual-v3/final.png`

初稿输出：`generation/scene-ritual-v3/draft.png`

生成提示词：

```text
Use case: stylized-concept.
Asset type: one standalone opaque PNG background painting for a frozen fantasy palace game, landscape EXACT 16:9, preferably 1536x864. ONE image, no atlas, no collage, no panels.
Style/medium: painterly crisp polished fantasy architectural illustration; match the project's existing empty ballroom/corridor look through silver-gray and white stone, pale ice-blue daylight, finely carved Gothic piers, clear frost, subtle old-gold/amber architectural trim. Restrained teal shadows only; keep the room light and legible. No photorealistic photo, no blurred atmosphere.
Composition/framing: near-to-mid distance local interior at standing eye level with slightly elevated perspective. Clearly readable enclosing walls and architectural construction; moderately sized room, not a huge empty plaza, not a whole castle, not a dollhouse cutaway, not a floor plan. Empty lower-center foreground for separately rendered game overlays, ceiling may be cropped. No invented open exits or views into other rooms.
Lighting/materials: diffuse pale cold daylight, frost-coated masonry, thin glossy ice on floor, crisp edges; small amber accents are material color, NEVER flames or glowing magic.
Constraints: architecture-only decorative backdrop, not a map and not evidence of routes or capabilities.
Avoid: any text, letters, numbers, runes, written glyphs, UI, border, watermark, people, NPCs, fixed characters, silhouettes, human or animal statues, animals, monsters, sacrifices, books, furniture except explicitly requested built-in architectural counter or partitions, interactive items, resources, treasure chests, boxes, coins, loot, barrels, bottles, glasses, tools, weapons, balloons, candles, torches, fire, flames, visible magic effects, quest markers.
Primary request: an EMPTY compact circular ritual chamber inside the frozen palace. Curved pale stone walls, short rounded piers supporting a shallow circular vault, a few frost-glazed sealed wall recesses. On the bare floor, one subtle empty concentric circular architectural inlay, purely geometric, NOT runes, no magical glow. Show the floor circle at readable mid distance and the enclosed room walls close by. No altar, no participant, no sacrifice.
```

一次编辑参考：`public/assets/scene-ritual-v3.png`（当时的初稿，先 view_image）；`referenced_image_paths` 仅包含该图。

编辑提示词：

```text
Use case: precise-object-edit. Asset type: same opaque landscape 16:9 frozen palace game background, ONE image.
Add richer peripheral furnishing to this otherwise empty circular frozen chamber: a frost-covered low carved stone side bench, weathered muted-blue fabric runners against the curved wall, shallow wall ledges holding anonymous ceramic vessels. Keep the EMPTY geometric circular floor inlay unobstructed; no altar, no occupant, no sacrifice, no magic. Preserve the existing walls, piers, near/mid composition and ice-blue/gray-white palette with modest amber trim.
Owner revised art boundary: decorative furnishings are allowed and do not imply interaction or resource availability. Preserve painterly crisp style. No people, residents, enemies, animals, fixed character, body, text, UI, coins, exact resource quantities, fire/flames, glowing magic, secret route, watermark or border. Edit only peripheral furnishings; retain main architecture, framing and floor geometry.
No lanterns, lamps, sconces, candles, torches or luminous fixtures anywhere; only cold diffuse window light. Nonluminous amber trim only.
```

### scene-treasure-v3.png

最终输出：`generation/scene-treasure-v3/final.png`

初稿输出：`generation/scene-treasure-v3/draft.png`

生成提示词：

```text
Use case: stylized-concept.
Asset type: one standalone opaque PNG background painting for a frozen fantasy palace game, landscape EXACT 16:9, preferably 1536x864. ONE image, no atlas, no collage, no panels.
Style/medium: painterly crisp polished fantasy architectural illustration; match the project's existing empty ballroom/corridor look through silver-gray and white stone, pale ice-blue daylight, finely carved Gothic piers, clear frost, subtle old-gold/amber architectural trim. Restrained teal shadows only; keep the room light and legible. No photorealistic photo, no blurred atmosphere.
Composition/framing: near-to-mid distance local interior at standing eye level with slightly elevated perspective. Clearly readable enclosing walls and architectural construction; moderately sized room, not a huge empty plaza, not a whole castle, not a dollhouse cutaway, not a floor plan. Empty lower-center foreground for separately rendered game overlays, ceiling may be cropped. No invented open exits or views into other rooms.
Lighting/materials: diffuse pale cold daylight, frost-coated masonry, thin glossy ice on floor, crisp edges; small amber accents are material color, NEVER flames or glowing magic.
Constraints: architecture-only decorative backdrop, not a map and not evidence of routes or capabilities.
Avoid: any text, letters, numbers, runes, written glyphs, UI, border, watermark, people, NPCs, fixed characters, silhouettes, human or animal statues, animals, monsters, sacrifices, books, furniture except explicitly requested built-in architectural counter or partitions, interactive items, resources, treasure chests, boxes, coins, loot, barrels, bottles, glasses, tools, weapons, balloons, candles, torches, fire, flames, visible magic effects, quest markers.
Primary request: an EMPTY small enclosed palace treasury chamber, expressed ONLY through rich architectural wall molding and two continuous translucent frosted ice-clad wall planes meeting around the back corner. Pale carved stone piers frame those wall surfaces. The floor is entirely bare; no contents, no hidden or visible chest, no human-shaped form embedded in ice. Ice walls are visual surface texture, NOT an interactive obstacle or secret passage. Near-to-mid architectural view.
```

一次编辑参考：`public/assets/scene-treasure-v3.png`（当时的初稿，先 view_image）；`referenced_image_paths` 仅包含该图。

编辑提示词：

```text
Use case: precise-object-edit. Asset type: same opaque landscape 16:9 frozen palace game background, ONE image.
Enrich this frozen treasury-looking enclosed corner with side-mounted storage shelves, decorative closed storage cases and anonymous aged metal bowls/urns, one low wood-and-metal console against a wall. These are non-canonical atmosphere, do NOT depict a hidden quest chest, a treasure reward, coins, glowing loot or countable resources. Preserve the two ice-glazed wall planes, architecture, frost, perspective, ice-blue gray-white materials and amber trim.
Owner revised art boundary: decorative furnishings are allowed and do not imply interaction or resource availability. Preserve painterly crisp style. No people, residents, enemies, animals, fixed character, body, text, UI, coins, exact resource quantities, fire/flames, glowing magic, secret route, watermark or border. Edit only peripheral furnishings; retain main architecture, framing and floor geometry.
No lanterns, lamps, sconces, candles, torches or luminous fixtures anywhere; only cold diffuse window light. Nonluminous amber trim only.
```

### scene-icebar-v3.png

最终输出：`generation/scene-icebar-v3/final.png`

初稿输出：`generation/scene-icebar-v3/draft.png`

生成提示词：

```text
Use case: stylized-concept.
Asset type: one standalone opaque PNG background painting for a frozen fantasy palace game, landscape EXACT 16:9, preferably 1536x864. ONE image, no atlas, no collage, no panels.
Style/medium: painterly crisp polished fantasy architectural illustration; match the project's existing empty ballroom/corridor look through silver-gray and white stone, pale ice-blue daylight, finely carved Gothic piers, clear frost, subtle old-gold/amber architectural trim. Restrained teal shadows only; keep the room light and legible. No photorealistic photo, no blurred atmosphere.
Composition/framing: near-to-mid distance local interior at standing eye level with slightly elevated perspective. Clearly readable enclosing walls and architectural construction; moderately sized room, not a huge empty plaza, not a whole castle, not a dollhouse cutaway, not a floor plan. Empty lower-center foreground for separately rendered game overlays, ceiling may be cropped. No invented open exits or views into other rooms.
Lighting/materials: diffuse pale cold daylight, frost-coated masonry, thin glossy ice on floor, crisp edges; small amber accents are material color, NEVER flames or glowing magic.
Constraints: architecture-only decorative backdrop, not a map and not evidence of routes or capabilities.
Avoid: any text, letters, numbers, runes, written glyphs, UI, border, watermark, people, NPCs, fixed characters, silhouettes, human or animal statues, animals, monsters, sacrifices, books, furniture except explicitly requested built-in architectural counter or partitions, interactive items, resources, treasure chests, boxes, coins, loot, barrels, bottles, glasses, tools, weapons, balloons, candles, torches, fire, flames, visible magic effects, quest markers.
Primary request: an EMPTY compact palace ice bar interior. A low built-in frozen pale stone bar counter runs along the rear-side wall, bare counter top; behind it only an unbroken ice-glazed paneled masonry wall with restrained amber molding. All shapes are permanently built-in architectural surfaces. No shelves containing anything, no drinks, no bottles, no vessels, no stools, no tables, no consumables. Near-to-mid view, small enclosed hospitality room, clear frozen counter silhouette.
```

一次编辑参考：`public/assets/scene-icebar-v3.png`（当时的初稿，先 view_image）；`referenced_image_paths` 仅包含该图。

编辑提示词：

```text
Use case: precise-object-edit. Asset type: same opaque landscape 16:9 frozen palace game background, ONE image.
Enrich the frozen bar with a row of softly varied anonymous unlabelled glass bottles on rear wall shelves, frosted cups and drinking glasses scattered naturally on the counter, empty stools and a small side table. No labels or exact resource counts, no highlighted collectible; all merely painted atmosphere. Preserve bar counter, architecture, ice-blue gray-white frost and amber trim, camera and composition. No bartender, customer or creature.
Owner revised art boundary: decorative furnishings are allowed and do not imply interaction or resource availability. Preserve painterly crisp style. No people, residents, enemies, animals, fixed character, body, text, UI, coins, exact resource quantities, fire/flames, glowing magic, secret route, watermark or border. Edit only peripheral furnishings; retain main architecture, framing and floor geometry.
No lanterns, lamps, sconces, candles, torches or luminous fixtures anywhere; only cold diffuse window light. Nonluminous amber trim only.
```

### scene-lower-v3.png

最终输出：`generation/scene-lower-v3/final.png`

初稿输出：`generation/scene-lower-v3/draft.png`

生成提示词：

```text
Use case: stylized-concept.
Asset type: one standalone opaque PNG background painting for a frozen fantasy palace game, landscape EXACT 16:9, preferably 1536x864. ONE image, no atlas, no collage, no panels.
Style/medium: painterly crisp polished fantasy architectural illustration; match the project's existing empty ballroom/corridor look through silver-gray and white stone, pale ice-blue daylight, finely carved Gothic piers, clear frost, subtle old-gold/amber architectural trim. Restrained teal shadows only; keep the room light and legible. No photorealistic photo, no blurred atmosphere.
Composition/framing: near-to-mid distance local interior at standing eye level with slightly elevated perspective. Clearly readable enclosing walls and architectural construction; moderately sized room, not a huge empty plaza, not a whole castle, not a dollhouse cutaway, not a floor plan. Empty lower-center foreground for separately rendered game overlays, ceiling may be cropped. No invented open exits or views into other rooms.
Lighting/materials: diffuse pale cold daylight, frost-coated masonry, thin glossy ice on floor, crisp edges; small amber accents are material color, NEVER flames or glowing magic.
Constraints: architecture-only decorative backdrop, not a map and not evidence of routes or capabilities.
Avoid: any text, letters, numbers, runes, written glyphs, UI, border, watermark, people, NPCs, fixed characters, silhouettes, human or animal statues, animals, monsters, sacrifices, books, furniture except explicitly requested built-in architectural counter or partitions, interactive items, resources, treasure chests, boxes, coins, loot, barrels, bottles, glasses, tools, weapons, balloons, candles, torches, fire, flames, visible magic effects, quest markers.
Primary request: an EMPTY lower-level palace interior, compact vaulted stone service hall. Thick pale gray-white masonry piers, low ribbed arches, flat continuous frost-dusted flagstone floor, closed stone wall bays. Less ornate than the ballroom, with a few restrained amber joints or trim details. Near-to-mid distance; ceiling and side piers close enough to read the architecture. No staircase, no new exit, no pit, no connected rooms, no storeroom objects.
```

一次编辑参考：`public/assets/scene-lower-v3.png`（当时的初稿，先 view_image）；`referenced_image_paths` 仅包含该图。

编辑提示词：

```text
Use case: precise-object-edit. Asset type: same opaque landscape 16:9 frozen palace game background, ONE image.
Enrich this lower palace service hall with weathered wooden wall-side storage shelving, plain folded cloth, anonymous ceramic vessels, simple stone-and-wood bench, modest broom and work implements at the edge. Keep architectural piers, sealed rear wall, local perspective, frost-coated surfaces and pale ice-blue gray-white palette with amber accents. Leave lower-center floor moderately clear; no stairs, open exits or new rooms.
Owner revised art boundary: decorative furnishings are allowed and do not imply interaction or resource availability. Preserve painterly crisp style. No people, residents, enemies, animals, fixed character, body, text, UI, coins, exact resource quantities, fire/flames, glowing magic, secret route, watermark or border. Edit only peripheral furnishings; retain main architecture, framing and floor geometry.
No lanterns, lamps, sconces, candles, torches or luminous fixtures anywhere; only cold diffuse window light. Nonluminous amber trim only.
```

### scene-stables-v3.png

最终输出：`generation/scene-stables-v3/final.png`

初稿输出：`generation/scene-stables-v3/draft.png`

生成提示词：

```text
Use case: stylized-concept.
Asset type: one standalone opaque PNG background painting for a frozen fantasy palace game, landscape EXACT 16:9, preferably 1536x864. ONE image, no atlas, no collage, no panels.
Style/medium: painterly crisp polished fantasy architectural illustration; match the project's existing empty ballroom/corridor look through silver-gray and white stone, pale ice-blue daylight, finely carved Gothic piers, clear frost, subtle old-gold/amber architectural trim. Restrained teal shadows only; keep the room light and legible. No photorealistic photo, no blurred atmosphere.
Composition/framing: near-to-mid distance local interior at standing eye level with slightly elevated perspective. Clearly readable enclosing walls and architectural construction; moderately sized room, not a huge empty plaza, not a whole castle, not a dollhouse cutaway, not a floor plan. Empty lower-center foreground for separately rendered game overlays, ceiling may be cropped. No invented open exits or views into other rooms.
Lighting/materials: diffuse pale cold daylight, frost-coated masonry, thin glossy ice on floor, crisp edges; small amber accents are material color, NEVER flames or glowing magic.
Constraints: architecture-only decorative backdrop, not a map and not evidence of routes or capabilities.
Avoid: any text, letters, numbers, runes, written glyphs, UI, border, watermark, people, NPCs, fixed characters, silhouettes, human or animal statues, animals, monsters, sacrifices, books, furniture except explicitly requested built-in architectural counter or partitions, interactive items, resources, treasure chests, boxes, coins, loot, barrels, bottles, glasses, tools, weapons, balloons, candles, torches, fire, flames, visible magic effects, quest markers.
Primary request: an EMPTY stone palace stable interior, near-to-mid view of a few close stone-arched stall compartments. Low thick masonry dividing walls and bare recessed stall interiors, pale ice coating and frost, one fully closed ice-sealed architectural timber wall panel at the back. Readable compact stable construction, not a barn panorama. No animals, no people, no hay, no feed, no bucket, no tack, no trough or loose equipment.
```

一次编辑参考：`public/assets/scene-stables-v3.png`（当时的初稿，先 view_image）；`referenced_image_paths` 仅包含该图。

编辑提示词：

```text
Edit this frozen palace stable image ONLY to REMOVE ALL lanterns and luminous light fixtures: the amber wall hanging lanterns and the small glowing tabletop lantern. Replace their spots with plain frost-coated stone wall or ordinary table surface. Use only cool diffuse window daylight, with amber restricted to NONLUMINOUS metal/wood material trim. Preserve all stall compartments, hay, tools, tack, fabric, floor, architecture, framing and crisp painterly texture. No flame, fire, candle, glowing light or magic anywhere. No people, animals, text, UI, counts or fixed characters. One opaque landscape image.
```

### scene-prison-v3.png

最终输出：`generation/scene-prison-v3/final.png`

初稿输出：`generation/scene-prison-v3/draft.png`

生成提示词：

```text
Use case: stylized-concept.
Asset type: one standalone opaque PNG background painting for a frozen fantasy palace game, landscape EXACT 16:9, preferably 1536x864. ONE image, no atlas, no collage, no panels.
Style/medium: painterly crisp polished fantasy architectural illustration; match the project's existing empty ballroom/corridor look through silver-gray and white stone, pale ice-blue daylight, finely carved Gothic piers, clear frost, subtle old-gold/amber architectural trim. Restrained teal shadows only; keep the room light and legible. No photorealistic photo, no blurred atmosphere.
Composition/framing: near-to-mid distance local interior at standing eye level with slightly elevated perspective. Clearly readable enclosing walls and architectural construction; moderately sized room, not a huge empty plaza, not a whole castle, not a dollhouse cutaway, not a floor plan. Empty lower-center foreground for separately rendered game overlays, ceiling may be cropped. No invented open exits or views into other rooms.
Lighting/materials: diffuse pale cold daylight, frost-coated masonry, thin glossy ice on floor, crisp edges; small amber accents are material color, NEVER flames or glowing magic.
Constraints: architecture-only decorative backdrop, not a map and not evidence of routes or capabilities.
Avoid: any text, letters, numbers, runes, written glyphs, UI, border, watermark, people, NPCs, fixed characters, silhouettes, human or animal statues, animals, monsters, sacrifices, books, furniture except explicitly requested built-in architectural counter or partitions, interactive items, resources, treasure chests, boxes, coins, loot, barrels, bottles, glasses, tools, weapons, balloons, candles, torches, fire, flames, visible magic effects, quest markers.
Primary request: an EMPTY compact palace prison stone room. Thick pale frost-coated masonry, low vault, a few empty cell alcoves divided by fixed gray iron vertical grilles. Bare clean ice-dusted stone floor visible in foreground, each cell interior visibly empty. Grilles are fixed architectural partitions, no highlighted locks or separate keys. No prisoners, no guards, no bodies, no chains, no beds, no furniture, no remains, no escape route.
```

一次编辑参考：`public/assets/scene-prison-v3.png`（当时的初稿，先 view_image）；`referenced_image_paths` 仅包含该图。

编辑提示词：

```text
Edit ONLY the illuminated wall sconces in this frozen palace prison. Remove all amber-glowing fixtures on the stone piers; replace with NONLUMINOUS plain carved metal trim or frost-covered stone. Remove warm reflections of these lights from the floor, use only cold window daylight. Keep all empty cells, bars, blankets, benches, pottery, masonry, chains and composition unchanged. No people, animals, flames, candles, lanterns, lamps, luminous fixtures, text, UI, counted resources. One opaque landscape image, preserve original painterly style.
```

### scene-tower-base-v3.png

最终输出：`generation/scene-tower-base-v3/final.png`

生成提示词：

```text
Use case: stylized-concept.
Asset type: one standalone opaque PNG background painting for a frozen fantasy palace game, landscape EXACT 16:9, preferably 1536x864. ONE image, no atlas, no collage, no panels.
Style/medium: painterly crisp polished fantasy architectural illustration; match the project's existing empty ballroom/corridor look through silver-gray and white stone, pale ice-blue daylight, finely carved Gothic piers, clear frost, subtle old-gold/amber architectural trim. Restrained teal shadows only; keep the room light and legible. No photorealistic photo, no blurred atmosphere.
Composition/framing: near-to-mid distance local interior at standing eye level with slightly elevated perspective. Clearly readable enclosing walls and architectural construction; moderately sized room, not a huge empty plaza, not a whole castle, not a dollhouse cutaway, not a floor plan. Empty lower-center foreground for separately rendered game overlays, ceiling may be cropped. No invented open exits or views into other rooms.
Lighting/materials: diffuse pale cold daylight, frost-coated masonry, thin glossy ice on floor, crisp edges; small amber accents are material color, NEVER flames or glowing magic.
Constraints: architecture-only decorative backdrop, not a map and not evidence of routes or capabilities.
Avoid: any text, letters, numbers, runes, written glyphs, UI, border, watermark, people, NPCs, fixed characters, silhouettes, human or animal statues, animals, monsters, sacrifices, books, furniture except explicitly requested built-in architectural counter or partitions, interactive items, resources, treasure chests, boxes, coins, loot, barrels, bottles, glasses, tools, weapons, balloons, candles, torches, fire, flames, visible magic effects, quest markers.
Primary request: an EMPTY compact circular palace tower-base hall. A curved perimeter stone structure with a clearly readable shallow spiral stair geometry hugging the back and side cylindrical wall, ice-coated steps, pale gray-white masonry. The spiral is architectural atmosphere ONLY; upper continuation disappears behind solid wall and beyond cropped ceiling, no doorway or revealed destination, no network of rooms. Bare circular floor in foreground. No creature, no balloon, no chest, no equipment.
```

### scene-tower-top-v3.png

最终输出：`generation/scene-tower-top-v3/final.png`

生成提示词：

```text
Use case: stylized-concept.
Asset type: one standalone opaque PNG background painting for a frozen fantasy palace game, landscape EXACT 16:9, preferably 1536x864. ONE image, no atlas, no collage, no panels.
Style/medium: painterly crisp polished fantasy architectural illustration; match the project's existing empty ballroom/corridor look through silver-gray and white stone, pale ice-blue daylight, finely carved Gothic piers, clear frost, subtle old-gold/amber architectural trim. Restrained teal shadows only; keep the room light and legible. No photorealistic photo, no blurred atmosphere.
Composition/framing: near-to-mid distance local interior at standing eye level with slightly elevated perspective. Clearly readable enclosing walls and architectural construction; moderately sized room, not a huge empty plaza, not a whole castle, not a dollhouse cutaway, not a floor plan. Empty lower-center foreground for separately rendered game overlays, ceiling may be cropped. No invented open exits or views into other rooms.
Lighting/materials: diffuse pale cold daylight, frost-coated masonry, thin glossy ice on floor, crisp edges; small amber accents are material color, NEVER flames or glowing magic.
Constraints: architecture-only decorative backdrop, not a map and not evidence of routes or capabilities.
Avoid: any text, letters, numbers, runes, written glyphs, UI, border, watermark, people, NPCs, fixed characters, silhouettes, human or animal statues, animals, monsters, sacrifices, books, furniture except explicitly requested built-in architectural counter or partitions, interactive items, resources, treasure chests, boxes, coins, loot, barrels, bottles, glasses, tools, weapons, balloons, candles, torches, fire, flames, visible magic effects, quest markers.
Primary request: an EMPTY compact upper tower chamber, enclosed curved pale stone walls and two tall frost-glazed ice windows showing only diffuse pale light, no detailed exterior topology. Ribbed stone vault and restrained amber architectural trim, bare frost-coated floor, near-to-mid distance. No person, no throne, no chair, no table, no book, no desk, no object, no staircase, no open doorway.
```

### scene-ballroom-v3.png

最终输出：`generation/scene-ballroom-v3/final.png`

生成提示词：

```text
Use case: stylized-concept.
Asset type: ONE standalone opaque PNG background painting, landscape 16:9, frozen fantasy palace game; no atlas or collage.
Style/medium: painterly crisp polished fantasy architectural illustration matching silver-gray/white carved stone, pale ice-blue daylight, clear frost and restrained antique-gold/amber material accents of the existing ballroom/corridor. Keep architectural structure clear, no blur.
Composition: intimate near-to-mid-distance local room at slightly elevated walking-eye-level; architecture and environmental furnishings occupy the midground and edges, leave modest lower-center foreground for independent overlays. Not a huge empty plaza, whole castle, map or cutaway. Sealed walls, no newly invented open exits or adjacent rooms.
Owner's updated art boundary: richly furnish the location with atmospheric objects and contents. All painted furnishings are merely decorative context, NEVER proof of current interactive targets, inventory, occupancy, resources or exact quantities. No emphasized collectible or counted resource pile.
Lighting/materials: diffuse cold daylight, frost-coated masonry, iced floor; small amber material accents, no fire.
Avoid: text, letters, numbers, labels, runes, UI, borders, watermark, fixed residents, NPCs, enemies, monsters, people, animals, human/animal silhouettes or statues, bodies, sacrifices, fire/flames, quest markers, glowing magic, actual coins or quantified resources. No canonical hidden treasure chest, no claim of a character's presence.
Primary request: a FULLY FURNISHED frozen palace BALLROOM, near-to-mid distance, not the old huge empty floor. Clearly legible Gothic ballroom architecture: silver-white carved piers, pale icy windows, dark cool blue drapes, restrained nonluminous amber carved trim. Bring frost-covered banquet tables and draped white/blue tablecloths into the left and right NEAR FOREGROUND and MIDGROUND so they occupy substantial image area; modest non-counted anonymous metal/ceramic tableware and ornamental ice-coated vases on them. Long upholstered empty benches against side walls, rich hanging curtains, carved column-base decorations. Show only a modest central dance-floor strip for independently drawn player overlay, NOT a large empty foreground or distant tables. Decorative wall mirror panels may be frosted but reflect NO person. Close room composition, full and rich visual density while architecture remains readable. No chandelier at all: do not depict or infer its current state. No NPC, resident, animal, fixed person, coins, reward quantities, canonical resource container, text, UI, candle, torch, fire, flame, lantern, lamp, sconce or luminous fixture. Light exclusively cold window daylight. ONE standalone opaque landscape 16:9 image.
```

## 旧资产保持不变

| 旧资产 | SHA-256（施工前后相同） |
| --- | --- |
| `scene-ballroom.png` | `082d6bc060dc53f837799686737f47c65fb6e26b8c1115a823d05961e3b64502` |
| `scene-corridor.png` | `41f6efe5d201a0e2585178604f0f76cd1c90fe26fba743970e908b8ca148ec1d` |
| `scene-bridge.png` | `85c71302e987764e7a4c89348cc93cbc5f5c9ad8f7e1b2af0926fcc89dfbce21` |

## 追加刷新：走廊、桥与地图

追加刷新 2 张背景与 1 张地图，不重做首批 9 张，
累计 **11 张独立横向背景 + 1 张纵向地图**。旧 PNG 保留原字节，当前界面消费 V3。
走廊与桥仍使用本说明的 Pepijn 与 Willem-Jan / ThawedThroughEverflame1.1 署名和 CC BY-SA 4.0 范围。
地图是旧底图的参考编辑，详细来源、许可、提示词及结构限制见 [MAP_ART_V3.md](MAP_ART_V3.md)，
并非从零生成或重新规划地理。
追加图只做一次内置 image_gen 调用及逐图 view_image，不重新迭代首批图片，
公开快照未重跑页面、世界路线或体验验收。

| 新资产 | PNG 信息 | SHA-256 |
| --- | --- | --- |
| `public/assets/scene-corridor-v3.png` | 1672 x 941，RGB | `e9d40dfcf0a36cda213bcb2ccbc15e0b3b2792851cadc9c5cb5ffdcfa0d70297` |
| `public/assets/scene-bridge-v3.png` | 1672 x 941，RGB | `dcf9640b64e9f368d14708926ab4b2f94b99d81e36217d2a0beac6db8e8543cd` |
| `public/assets/palace-geographic-v3.png` | 1051 x 1496，RGBA | `07ca8439cda588bc315c796029f9803e2bccfa64d60032d275ca3340d52cc315` |

### scene-corridor-v3.png

最终真实输出：`generation/scene-corridor-v3/final.png`

只使用内置 image_gen，`transparent_background=false`；新生成，无 reference/edit 参数，无 fallback。

完整提示词：

```text
Use case: stylized-concept.
Asset type: ONE standalone opaque PNG background painting, landscape 16:9, frozen fantasy palace game; no atlas or collage.
Style/medium: painterly crisp polished fantasy architectural illustration matching silver-gray/white carved stone, pale ice-blue daylight, clear frost and restrained antique-gold/amber material accents of the existing ballroom/corridor. Keep architectural structure clear, no blur.
Composition: intimate near-to-mid-distance local room at slightly elevated walking-eye-level; architecture and environmental furnishings occupy the midground and edges, leave modest lower-center foreground for independent overlays. Not a huge empty plaza, whole castle, map or cutaway. Sealed walls, no newly invented open exits or adjacent rooms.
Owner's updated art boundary: richly furnish the location with atmospheric objects and contents. All painted furnishings are merely decorative context, NEVER proof of current interactive targets, inventory, occupancy, resources or exact quantities. No emphasized collectible or counted resource pile.
Lighting/materials: diffuse cold daylight, frost-coated masonry, iced floor; small amber material accents, no fire.
Avoid: text, letters, numbers, labels, runes, UI, borders, watermark, fixed residents, NPCs, enemies, monsters, people, animals, human/animal silhouettes or statues, bodies, sacrifices, fire/flames, quest markers, glowing magic, actual coins or quantified resources. No canonical hidden treasure chest, no claim of a character's presence.
Primary request: a compact upper palace hall / corridor interior. Near-to-mid-distance view of the frozen vaulted architecture, pale ice-blue Gothic windows, silver-gray carved stone wall panels, clear piers with restrained nonluminous gold detailing. Make the lived-in environment visually rich with a long empty upholstered wall bench, frost-dusted narrow console table, anonymous ceramic or metal vases, gathered dark cool-blue drapery, modest folded fabric and carved column-base ornament. Furnishings clustered along walls; moderate clear near foreground, not a huge bare plaza. End in a SEALED stone wall bay, no invented open doors, additional exits, stairs or adjacent rooms. No NPC, person, animal, enemy, fixed occupant, text, UI, resource quantities or actual coins. No lanterns, lamps, sconces, candles, torches or luminous fixtures, no fire/flame; cold diffuse window daylight only. One standalone landscape 16:9 PNG.
```

### scene-bridge-v3.png

最终真实输出：`generation/scene-bridge-v3/final.png`

只使用内置 image_gen，`transparent_background=false`；新生成，无 reference/edit 参数，无 fallback。

完整提示词：

```text
Use case: stylized-concept.
Asset type: ONE standalone opaque landscape 16:9 PNG frozen palace local background, no atlas/collage.
Primary request: a CLOSE readable local view of ONE narrow stone footbridge coated in pale ice and white frost spanning a deep blue-gray abyss. Camera slightly above walking height, oblique perspective along the short visible span. Bring the bridge approach and icy stone paving close into the lower foreground, coarse stone joints, thin frosted edge stones and clear ice-rimed structural sides. Midground bridge continues only beyond the crop, destination NOT revealed. Dark deep chasm visible to its sides, sparse pale diffuse mist far below but bridge surface and construction crisp and visible. Rich naturally chipped ice, weathered pale stone, subtle nonluminous warm metal inlay at most; match the new painterly polished ice-blue gray-white palace look.
Constraints: ONLY this existing bridge section; no bridge branches, forks, added platform, extra bridge, new road, buildings, doors, castle panorama, map, complete destination topology or implied new routes. Environmental painting only, not proof of traversal capability.
Avoid: people, NPCs, inhabitants, fixed characters, silhouettes, enemies, monsters, animals, text, runes, UI, labels, node dots, coins, inventory/resources, treasure chests, boats, balloons, glowing magic, fire, flames, lamps, lanterns, candles, torches, watermark/border. Clear near/mid perspective, not tiny bridge far away or empty icy plaza.
```

### palace-geographic-v3.png

最终真实输出：`generation/palace-geographic-v3/final.png`

内置 image_gen 参考编辑；`referenced_image_paths` 仅为
`public/assets/palace-geographic-v1.png`；`transparent_background=true`。
V3 沿用原有归一化叠层坐标。
仍不宣称逐像素边界等同；已知描边厚度变化及部分青色透明边缘残留记于 MAP_ART_V3.md。

完整提示词：

```text
Use case: style-transfer.
Asset type: ONE transparent-background portrait PNG EDIT of the supplied existing palace geographic map; NOT a new map or new layout.
Reference/edit target: public/assets/palace-geographic-v1.png. Existing file is 1051x1496 RGBA; logical site SVG coordinates are 900x1280. Preserve original portrait aspect ratio and original normalized geometry, placement, camera and image margins exactly; pixel count may differ.
PRIMARY INVARIANT: retain EVERY existing region/building floor-plane boundary, every wall outline and thickness, every door-opening silhouette, every column location/scale, every staircase and step direction, the upper-left narrow bridge and its exact outline, every vertical structural connection and both right-hand towering edges. All vertices and features stay at the SAME normalized x/y positions and SAME relative scales. Do NOT shift, widen, shorten, rotate, recenter, crop, rearrange, simplify or invent any geography. Existing top blank padding and bottom spacing remain. This image is a visual underlay for fixed-coordinate overlays; changed geometry is unacceptable.
Edit ONLY texture, brushwork and palette, without moving edges. Replace flat cyan comic fill with fine crisp painterly ice-blue/gray-white frozen stone, restrained nonluminous antique-gold architectural accents, softly modeled frost and clear carved masonry surfaces matching the new palace room backgrounds. Retain the exact existing isometric cutaway view and original empty architectural state. Keep all floors clear and empty, all reference doors and bridge shapes intact. Retain the existing lower-left barred-cell architectural walls, central room planes, upper columned hall, upper-right platform, lower/right tower chamber, connecting steps and bridge precisely where the reference placed them, not a redesign.
Transparency: preserve genuine transparent exterior around architecture, including all existing gaps between planes; no solid black/white/sky background, no scenic vignette. Do not add a shadow extending silhouette or perspective extrusion outside current outlines.
Avoid: ANY text, letters, labels, numbered rooms, nodes, map pins, UI, routes drawn over map, occupants, characters, animals, statues, furniture, boxes, chests, coins, events, flames, glow, added door, bridge branch, changed stairs, added room, widened paths, new terrain, border, watermark. Repaint materials within original outlines ONLY.
```
