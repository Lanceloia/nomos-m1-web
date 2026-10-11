# 公开源码快照

## 来源与配套版本

- 应用源码：`715ebc7ad10cd3053b2d9f88d38b25a0070b8a3f` 的 tracked 树，经 `git archive` 导出。
- Web 发布标签：`showcase-2026-10-11`，指向本仓库首个根提交。
- 配套引擎：`ce190292c75d8e36da2e692c7b5dfaf08323ebde`，公开远端同名标签已核实。
- 克隆命令见 [README](../README.md)；Web 目标目录为 `m1-tabletop-prototype`，相邻引擎目录为 `nomosengine2-release`。
- 不复制旧 `.git` 历史、虚拟环境或安装依赖。新提交身份使用项目 noreply，README 保留 Owner、Codex 与协作者归因。

## 有界整理

运行代码、脚本、具名测试、策略 YAML、图片和字体不改行为或字节。
移出 15 份内部协作/旧快照文档及 48 份旧会话证据；这些文件不被代码作为测试夹具读取。
保留公开安装、分享、素材及检查说明。素材记录中的个人机器路径和工具会话标识换成逻辑来源，
完整生成指令、原作署名和许可保留。原始/公开提示词的 SHA-256 分别记录，不混称为未编辑原文。

字体准确名称为 Noto Sans CJK SC，版本 2.004，保留内嵌版权和完整 OFL；
上游及既有转换记录的限制见 [素材说明](ART.md)。
锁文件 150 个下载地址机械替换为官方 npm registry，所有 integrity 及其余结构不变。

## 本次静态结果

- 127 个运行、测试、配置及素材文件与源快照 Git blob 逐字节相同。
- [摘要清单](../public/assets/provenance-hashes.json)的 18 个素材和 26 对原始/公开提示词摘要核对通过。
- 所有公开 Markdown 的本地链接目标核对；不把逻辑来源标识当作包含在仓库中的文件。
- 文本凭据及个人路径扫描无真实凭据、私有邀请链接或个人机器路径命中；邀请地址为测试样例。
- 新 Git 历史只有本次根提交；不继承原仓库作者邮箱、旧分支、标签或会话材料。

具名静态 launcher 命令：

```bash
node --test --test-name-pattern='development launches|preview uses|only explicit|Windows selects|malformed ports|startup timeout|sharing uses|explicit sharing|only the temporary|fast default|layout is' scripts/dev.test.mjs scripts/share.test.mjs scripts/preplay-check.test.mjs
```

结果为 11 项通过，不选中监听端口测试，不启动应用。

```bash
npm run build
```

只运行一次，TypeScript 检查及 Vite 5.4.21 production build 通过（1595 个模块）。
验证环境 Node.js 24.16.0；借用已安装依赖的临时 `node_modules` 链接已删除，未提交。
`dist/` 为 ignored 构建产物。

## 边界与发布

本次不运行应用、Compile、游戏行动、浏览器实玩、性能门或引擎 pytest。
没有重做 `npm ci` 或最低 Node/Python 版本安装；静态扫描不证明不存在编码隐藏的秘密。
仅整理公开快照并检查构建，不新增世界能力或声称新实玩验证。
原应用、引擎、发行和简历工作树不在写集内。公开仓库创建与推送由发布方完成。
