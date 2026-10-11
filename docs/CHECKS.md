# 具名检查

所有运行代码、测试模块、策略 YAML、图片和字体来自同一应用源码快照。
旧试玩报告、内部协作记录和旧会话证据不随公开快照发布；它们不是测试夹具或运行依赖。

## 不启动应用的检查

```bash
node --test --test-name-pattern='development launches|preview uses|only explicit|Windows selects|malformed ports|startup timeout|sharing uses|explicit sharing|only the temporary|fast default|layout is' scripts/dev.test.mjs scripts/share.test.mjs scripts/preplay-check.test.mjs
npm run build
```

具名 launcher 检查只核对配置和命令规划；不选中占用端口的监听测试。
构建检查 TypeScript 并生成 `dist/`，不编译作者世界或运行游戏。

## 按需模块检查

`npm test` 只选择 `src/tabletop.test.ts` 和 `src/client.test.ts`。
其他前端模块按改动显式指定，例如：

```bash
npx vitest run src/action-memory.test.ts src/action-window.test.ts
npm run test:bridge -- server.test_feedback_v5 server.test_torch_conversation
```

桥接测试使用本目录虚拟环境及相邻发行引擎，必须指定 `server.test_*`。
部分具名模块会编译世界或执行行动，按模块的说明选择，不作为默认静态检查。

## 浏览器与证据

浏览器脚本需要 Playwright Chromium（`npx playwright install chromium`）及已运行的 Web 服务。
用脚本读取的环境变量指定当前 URL 和输出目录，不复用历史会话或默认旧端口作为发行依据。

- `scripts/check-browser.mjs`：`M1_TABLETOP_URL`、`M1_TABLETOP_EVIDENCE`。
- `scripts/check-family-mobile.mjs`：`M1_FAMILY_URL`、`M1_FAMILY_BASELINE`、`M1_FAMILY_EVIDENCE`。
  默认输出目录是 `docs/family-mobile/evidence`；公开工作使用 `test-results/family-mobile`，不要提交会话账或截图。
- `scripts/check-sharing.mjs`：传入本次分享启动器打印的私有状态文件；会创建两局并发布一次行动。
- `scripts/release-browser.mjs`、`scripts/journey-v3-browser.mjs`：分别需要
  `M1_EVIDENCE`、`M1_JOURNEY_EVIDENCE` 指定本次同一服务的真实会话证据。

试玩前结构检查为 `npm run check:preplay`，固定状态布局为 `npm run check:preplay:layout`。
它们不等于实玩或新的体验接受；公开快照本次没有运行这些工作流。
