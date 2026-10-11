# 冰焰解冻之旅 · M1 试玩

用 NomosEngine2 作者规则驱动的冰宫冒险。携带永焰探索、解除冻结、帮助居民离宫，
也可以选择人格倾向，让角色根据当前已知局面自动行动。

[Web 源码](https://github.com/Lanceloia/nomos-m1-web) ·
[引擎源码](https://github.com/Lanceloia/NomosEngine2-release)

## 安装

需要 Git、Node.js 20.3+、Python 3.11+。两个仓库使用匹配标签 `showcase-2026-10-11`，
Web 克隆到 `m1-tabletop-prototype`，保留启动器的默认相邻路径：

```bash
git clone --branch showcase-2026-10-11 https://github.com/Lanceloia/NomosEngine2-release.git nomosengine2-release
git clone --branch showcase-2026-10-11 https://github.com/Lanceloia/nomos-m1-web.git m1-tabletop-prototype
cd m1-tabletop-prototype
python3 -m venv .venv
.venv/bin/python -m pip install -e ../nomosengine2-release
npm ci
```

Windows 可用 `python -m venv .venv`，并将 `.venv/bin/python` 换成 `.venv\Scripts\python.exe`。

## 启动

```bash
npm run dev
```

打开 <http://127.0.0.1:5173/>。启动器先编译世界，再打开页面；开发 API 默认使用 8791。
首次编译需要等待，之后各局复用同一 Program，游戏状态彼此独立。

本地展示使用页面与 API 同源服务：

```bash
npm run build
npm start
```

同样访问 5173，`Ctrl+C` 关闭本次服务。端口占用时可用 `M1_WEB_PORT=5180 npm start`。
非相邻安装可设置 `NOMOS_ENGINE_ROOT`，自选 Python 可设置 `NOMOS_PYTHON`，
慢速机器可设置 `M1_STARTUP_TIMEOUT_MS`。

邀请朋友或家人远程试玩：`npm run share`。
安装 cloudflared、私有 HTTPS 链接和关闭入口见 [分享说明](docs/SHARING.md)。

## 试玩

- 中央场景展示当前人物与物件，行动面板提供可尝试选项。选择目标、阅读预告，再确认执行。
- 地图区分当前在场与过去观察；行动回执显示实际移动、消耗、解冻和居民答复。
- “人格倾向”可用于手动建议或授权代行。可设置推进步数、暂停或交还手动控制。
- 终局保留现场，打开结算查看共同成就和行动记录。

当前是单人冒险，不同浏览器各自开局；桌面和手机均可使用。

## 代码与验证

| 路径 | 内容 |
| --- | --- |
| `src/` | React 界面、行动确认、地图与反馈 |
| `server/` | HTTP 会话桥接、公开信息投影与人格建议 |
| `scripts/` | 启动、分享及具名检查脚本 |
| `../nomosengine2-release/src/nomos_examples/everflame/` | 作者规则、开局和玩家评价声明 |
| `public/assets/` | 场景、地图、字体及来源记录 |

模块检查入口：

```bash
npm run test:launcher
npm test
npm run test:bridge -- server.test_feedback_v5 server.test_torch_conversation
npm run build
```

桥接检查显式指定 `server.test_*`；其他浏览器与试玩检查的依赖见 [验证说明](docs/CHECKS.md)。

## 来源

应用代码来自 `715ebc7ad10cd3053b2d9f88d38b25a0070b8a3f` 的 tracked 源码树。
项目 Owner 提供目标、设计裁决和体验反馈；应用代码及验证主要由 Codex 与协作者实现。
本仓库是无旧 Git 历史的公开源码快照，本次整理文档与素材来源，不声称新增实玩验证。
本次检查结果见 [公开快照记录](docs/PUBLIC_SNAPSHOT.md)。

原作 *Thawed Through the Everflame* 1.1 由 Pepijn 和 Willem-Jan 创作，
[原作者发布页](https://1pagedungeons.itch.io/opd-contest-entries)标明 CC BY-SA 4.0。
世界改编、地图与 V3 场景保留署名和相同许可；原创应用代码不新增复用授权。
详见 [权利说明](RIGHTS.md)与[素材说明](docs/ART.md)。
