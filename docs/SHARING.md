# 邀请家人试玩

本地服务之外，可开启一个带邀请凭证的临时 HTTPS 链接。打开完整链接后自动进入游戏，
各浏览器有自己的游戏进度。电脑保持联网，分享窗口默认两小时，结束时自动关闭本次服务与隧道。

## 开启

安装官方 [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)，
默认程序位置为 `~/.local/bin/cloudflared`，也可用 `CLOUDFLARED` 指定。
在本目录执行：

```bash
npm run build
npm run share
```

启动器会编译真实世界，随后打印完整邀请链接、关闭时间和关闭命令。把完整链接私发给试玩者即可。
分享使用独立的本机 `5195` 端口，保留原本地服务和已有进度。重新开启时会得到新的链接。

```bash
M1_SHARE_MINUTES=240 M1_SHARE_PORT=5196 npm run share
```

可设置 15–1440 分钟。默认最多保留 16 局，可用 `M1_SHARE_MAX_GAMES` 设置 1–128 局；
每局复用同一编译 Program。遇到启动错误，终端会指向本次私有日志。

## 关闭

复制启动器打印的关闭命令，例如：

```bash
node scripts/share.mjs --stop "<state-file>"
```

它校核并关闭本次监督进程，由监督进程结束自己启动的游戏服务和隧道。
邀请码与日志位于用户目录的私有状态文件夹，权限为 `0700/0600`，不提交 Git。
关闭后会删除邀请码及状态文件中的完整邀请链接；日志可自行保留或清理。

## 访问与实际验证

分享页面使用 HTTPS，完整链接里的邀请凭证只在首次换取浏览器 Cookie 时使用，随后从地址栏移除。
Cookie 标为 Secure、HttpOnly、SameSite=Strict；修改游戏的请求只接受本次链接的精确 Origin。
外部健康检查仅显示是否就绪和编译次数。完整链接相当于钥匙，请仅发送给预定试玩者。
这是一项家庭邀请入口，使用同一邀请码，不建立玩家账户。

首次分享时，让对方用手机打开完整链接、看到冰宫并完成一次行动，确认所用网络和浏览器能正常访问。
临时隧道的地址和可用性受网络影响；电脑休眠、断网或分享窗口结束后，需要重新开启。

短测试：

```bash
node --test scripts/share.test.mjs scripts/dev.test.mjs
node scripts/test-bridge.mjs server.test_share_access
```

上述短门验证访问与启动合同，不编译世界；真实公开链接的开局、行动与会话隔离另作浏览器核对。

可用启动器打印的私有状态文件做一次公开短验证：

```bash
node scripts/check-sharing.mjs "<state-file>"
```

它通过真实 HTTPS 邀请页开两局、在第一局检查一次脚下，核对两局独立及访客访问/错误 Origin 拒绝，
最后关闭自有浏览器。证据默认写入 `test-results/family-share/`，不记录邀请码。
这会新建两局并发布一次真实行动，请仅在分享集成点运行。
