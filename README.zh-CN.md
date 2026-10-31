# Loop Now Figma 插件

[English](https://github.com/AI-for-anyone/loop-now-plugin-figma/blob/main/README.md)

一个 [Loop Now](https://github.com/AI-for-anyone/loop-now) 插件：让 Agent 通过 **Figma 桌面版自带的 MCP 服务器** 读取设计稿，包括某个画框或图层的代码与设计上下文、图层结构、截图、颜色间距字体等变量、FigJam 白板，以及 Code Connect 映射。

它只有 Agent 半边：一个 Skill（什么时候用哪个工具、怎么从 Figma 链接取节点、连不上时怎么办），加一条 MCP 服务器声明。没有平台半边，不要任何权限，也没有配置项和账号。

## 需要

- 支持 url 型 MCP 条目的 Loop Now。更早的版本安装时会报“"desktop" 须是带 command 的对象”。
- Loop Now 所在的机器上装着 Figma 桌面版，并已登录。桌面版的 MCP 服务器只监听本机 `127.0.0.1:3845`，所以必须是同一台机器。
- Figma 账号在付费计划（Professional、Education、Organization、Government、Enterprise）上有 **Dev 或 Full 席位**。

## 1. 在 Figma 桌面版里开启 MCP 服务器

1. 把 Figma 桌面版更新到最新。
2. 打开或新建一个 Design 文件。
3. 不选中任何东西，切到 Dev Mode（工具栏上的开关，或 Shift D）。
4. 在右侧的 **MCP server** 一栏点 **Enable desktop MCP server**，出现服务器正在运行的提示即可。

桌面版退出后服务器也随之停止。重新打开桌面版后如果 Agent 连不上，回 Dev Mode 看一下这个开关。

检查服务器是否在运行：

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3845/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}'
```

返回 `200` 表示在运行；`000` 表示没有在听，即桌面版没开或服务器没开启。

## 2. 在 Loop Now 里安装

控制台：**插件市场** › **安装插件**，来源选 **git 仓库**，**仓库地址** 填 `https://github.com/AI-for-anyone/loop-now-plugin-figma.git`；也可以选 **本地目录**，填这个仓库在 Loop Now 那台机器上的绝对路径。或者用命令行：

```sh
loopctl plugin install https://github.com/AI-for-anyone/loop-now-plugin-figma.git@main --force
```

`--force` 确认安装非官方来源。插件没有运行依赖，安装时什么也不下载。

## 3. 启用并授权给 Agent

1. **项目设置** › **插件** › **管理项目插件**：启用 **Figma**。
2. 需要看设计稿的 Agent，在其配置的 **插件权限** 一栏授权 **Figma** 并保存。

授权后，平台把 MCP 条目写进该 Agent 的 Pi `mcp.json`，条目名为 `figma-desktop`，工具名以 `mcp__figma_desktop__` 开头；Skill 也一并交给 Pi。这些在该 Agent 下次启动 Pi 时生效。

## 验证

1. 用上面的 `curl` 确认服务器在运行。
2. 在 Figma 桌面版里右键一个画框，选 **Copy link to selection**，对 Agent 说：“看一下这个设计：<链接>，告诉我它的图层结构。”Agent 会调用 `mcp__figma_desktop__get_metadata` 等工具，调用在运行记录里可见。
3. Agent 说没有 Figma 工具时，看下面的“限制”最后两条。

## 工具

| 工具 | 用途 |
|---|---|
| `get_design_context` | 画框或图层的结构、样式和参考代码，默认是 React + Tailwind（主要工具） |
| `get_metadata` | 图层树：id、名称、类型、位置和尺寸；不给节点时列出页面 |
| `get_screenshot` | 截图，用来核对外观 |
| `get_variable_defs` | 用到的变量与样式（颜色、间距、字体等） |
| `get_figjam` | FigJam 白板的结构与截图 |
| `get_motion_context` | 动效：关键帧、缓动、CSS 动画 |
| `get_code_connect_map`、`add_code_connect_map` 等 | Code Connect：查看或添加设计组件到代码组件的映射 |

实际的工具列表与参数以 Figma 桌面版提供的为准。

## 限制

- 不能在画布上创建或修改内容，不能新建文件、上传图片、生成图表：这些只有远程版服务器提供。
- 没有远程版才有的 `search_design_system`、`get_libraries`、`whoami` 等工具。
- 只能读你的 Figma 账号本来就能打开的文件。
- 调用次数按 Figma 席位限制，读取类工具才计数：
  - Dev 或 Full 席位：Professional 计划每天 200 次、每分钟 10 次；Organization 每天 200 次、每分钟 15 次；Enterprise 每天 600 次、每分钟 20 次。
  - View 或 Collab 席位：每月 20 次。
  - 以 Figma 的[说明](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)为准。
- **Pi 启动时桌面版没开**：这个 Agent 的 Pi 里不会出现 Figma 工具，之后开了也不会自己连上，要等这个 Agent 的 Pi 下次启动。平台在 Agent 空闲一段时间后回收它的 Pi 进程（默认 10 分钟），之后的第一条消息会重新启动并连上。
- **用着用着关掉了桌面版**：调用会报连接失败；重新打开并开启服务器后，下一次调用自动重连。

## 远程版（等 Figma 批准）

Figma 的远程 MCP 服务器（`https://mcp.figma.com/mcp`）功能更多，包括写画布和搜索设计库，但只接受 [Figma MCP 目录](https://www.figma.com/mcp-catalog/) 里的客户端。它在注册 OAuth 客户端时按客户端名字放行，Pi 和 Loop Now 目前都不在名单上。这个插件不冒充别的客户端的名字，所以远程版等 Loop Now 进入目录后再加。

获批之后的做法（尚未实现，也没有验证过）：

- 在清单的 `loopNow.mcpServers` 里加一条，合并后的名字是 `figma-remote`：

  ```json
  "remote": { "url": "https://mcp.figma.com/mcp", "oauth": { "clientName": "Loop Now" } }
  ```

- **每个 Agent 登录一次**。Pi 把 OAuth 令牌存在 Agent 自己的 Pi 目录（`<work root>/agents/<Agent id>/pi/mcp-auth.json`），不在 Agent 之间共用。平台目前没有在控制台里替 Agent 登录的入口，做法是让 Agent 在自己的 shell 里运行：

  ```sh
  pi mcp login figma-remote --timeout 300
  ```

  它打印授权链接，并在 Loop Now 那台机器上打开浏览器；在浏览器里点 **Allow access**，回调落在本机 `127.0.0.1`。令牌写好后，正在运行的会话在下一轮自动重连，不用重启 Pi。`pi` 须在 Agent 的 PATH 里。

## 开发

需要 Node 24（测试是 TypeScript，由 Node 直接运行）。插件没有依赖。

```sh
npm test            # 真实的 Pi（RPC 模式、Loop Now 的启动参数）加载 Skill 与假的 Figma 桌面版 MCP 服务器，用离线模型发出工具调用
                    # 找不到 Pi 时跳过这部分；LOOP_NOW_TEST_PI_ROOT 指定 Pi 包目录（默认 /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent）
(cd ../loop-now/plugins && npm ci && npm run build)
npm run validate    # node ../loop-now/plugins/host/dist/main.js validate .
```

```
loop-now-plugin-figma/
├── package.json             清单：pi.skills 与 loopNow.mcpServers.desktop
├── skills/figma/SKILL.md    给 Agent 的说明：工具选择、链接规则、连不上时怎么办
└── test/
    ├── plugin.test.ts       清单与 Skill 的约定；真实 Pi 里的加载、调用、断线与重连
    ├── fake-figma.ts        假的桌面版 MCP 服务器（streamable HTTP）
    └── fixtures/offline-provider.ts  测试用的离线模型
```

## 许可

Apache-2.0
