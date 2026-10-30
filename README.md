# Loop Now for Figma

[中文](README.zh-CN.md)

A [Loop Now](https://github.com/AI-for-anyone/loop-now) plugin that lets Agents read Figma designs through **the MCP server built into the Figma desktop app**. Agents get the code and design context of a frame or layer, the layer structure, screenshots, variables such as colors, spacing and type, FigJam boards, and Code Connect mappings.

It is an Agent-only plugin: one Skill and one MCP server entry. The Skill tells the Agent which tool to use when, how to get a node from a Figma link, and what to do when the server cannot be reached. There is no platform half, and the plugin needs no permissions, configuration or accounts.

## Requirements

- A Loop Now build that accepts URL-based MCP entries. Older builds refuse to install the plugin with `"desktop" 须是带 command 的对象` ("must be an object with a command").
- The Figma desktop app, installed and signed in, on the same machine as Loop Now. Its MCP server listens only on `127.0.0.1:3845`.
- A **Dev or Full seat** on a paid Figma plan (Professional, Education, Organization, Government or Enterprise).

## 1. Turn on the MCP server in the Figma desktop app

1. Update the Figma desktop app to the latest version.
2. Open or create a Design file.
3. With nothing selected, switch to Dev Mode (the toolbar toggle, or Shift D).
4. In the **MCP server** section of the right sidebar, click **Enable desktop MCP server**. A message confirms that the server is running.

The server stops when the desktop app quits. If an Agent cannot connect after you reopen the app, check the toggle in Dev Mode again.

To check that the server is running:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3845/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}'
```

`200` means it is running. `000` means nothing is listening: the desktop app or its server is off.

## 2. Install the plugin in Loop Now

The console is in Chinese; the labels it shows are given in parentheses. In the console: **Plugins (插件) › Install plugin (安装插件)**, source git repository, URL `https://github.com/AI-for-anyone/loop-now-plugin-figma.git`. Alternatively, choose a local directory and give the path of this repository on that machine. Or with the CLI:

```sh
loopctl plugin install https://github.com/AI-for-anyone/loop-now-plugin-figma.git@main --force
```

`--force` confirms a source that is not an official plugin. The plugin has no runtime dependencies, so nothing is downloaded.

## 3. Enable it and grant it to Agents

1. In the project, **Plugins (插件)**: enable **Figma**.
2. In each Agent's configuration, plugins section: grant it to the Agents that should read designs.

Once granted, the platform writes the MCP entry into that Agent's Pi `mcp.json` as `figma-desktop`, so the tools are named `mcp__figma_desktop__*`, and hands the Skill to Pi. Both take effect the next time the Agent's Pi starts.

## Check that it works

1. Use the `curl` command above to confirm that the server is running.
2. In the Figma desktop app, right-click a frame, choose **Copy link to selection**, and ask the Agent: "Look at this design: <link>, and tell me its layer structure." The Agent calls `mcp__figma_desktop__get_metadata` and related tools. The calls appear in the run log.
3. If the Agent says it has no Figma tools, see the last two items under **Limitations**.

## Tools

| Tool | Use |
|---|---|
| `get_design_context` | Structure, styles and reference code of a frame or layer; React + Tailwind by default (the main tool) |
| `get_metadata` | Layer tree: IDs, names, types, positions and sizes; without a node, the list of pages |
| `get_screenshot` | A screenshot, to check how it looks |
| `get_variable_defs` | Variables and styles in use (colors, spacing, type and so on) |
| `get_figjam` | Structure and screenshots of a FigJam board |
| `get_motion_context` | Motion: keyframes, easing, CSS animations |
| `get_code_connect_map`, `add_code_connect_map` and related tools | Code Connect: view or add mappings from design components to code components |

The tools and their parameters are whatever the Figma desktop app offers.

## Limitations

- Nothing can be created or changed on the canvas, and Agents cannot create files, upload images or generate diagrams. Those features exist only on the remote server.
- Remote-only tools such as `search_design_system`, `get_libraries` and `whoami` are not available.
- Agents can read only files your Figma account can open.
- Figma limits calls by seat, counting only tools that read data:
  - Dev or Full seat: Professional allows 200 per day and 10 per minute, Organization 200 per day and 15 per minute, Enterprise 600 per day and 20 per minute.
  - View or Collab seat: 20 per month.
  - Figma's [rate limits page](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/) is authoritative.
- **The desktop app was closed when the Agent's Pi started**: that Pi has no Figma tools, and it does not connect by itself once the server comes up. The tools appear the next time the Agent's Pi starts. The platform recycles an idle Agent's Pi process after a while (10 minutes by default), and the next message starts a new one, which connects.
- **The desktop app is closed while in use**: calls fail to connect. After you reopen it and turn the server on, the next call reconnects by itself.

## Remote server (waiting for Figma's approval)

Figma's remote MCP server (`https://mcp.figma.com/mcp`) offers more, including writing to the canvas and searching design libraries. However, it accepts only clients listed in the [Figma MCP catalog](https://www.figma.com/mcp-catalog/): it admits OAuth client registrations by client name, and neither Pi nor Loop Now is on the list. This plugin does not register under another client's name, so the remote server will be added once Loop Now is in the catalog.

What it will look like after approval (not implemented or tested yet):

- One more entry under `loopNow.mcpServers`, merged as `figma-remote`:

  ```json
  "remote": { "url": "https://mcp.figma.com/mcp", "oauth": { "clientName": "Loop Now" } }
  ```

- **Each Agent signs in once.** Pi keeps OAuth tokens in the Agent's own Pi directory (`<work root>/agents/<Agent id>/pi/mcp-auth.json`), so Agents do not share them. The platform has no console sign-in for Agents yet; instead, the Agent runs this in its own shell:

  ```sh
  pi mcp login figma-remote --timeout 300
  ```

  It prints the authorization link and opens a browser on the Loop Now machine. Click **Allow access** in the browser; the callback goes to `127.0.0.1` on the same machine. Once the tokens are stored, the running session reconnects on its next turn, with no Pi restart. `pi` must be on the Agent's PATH.

## Development

Requires Node 24, which runs the TypeScript tests directly. The plugin has no dependencies.

```sh
npm test            # a real Pi (RPC mode, Loop Now's launch flags) loads the Skill and a fake Figma desktop MCP server; an offline model makes the tool calls
                    # skipped when Pi is not found; LOOP_NOW_TEST_PI_ROOT points at the Pi package (default /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent)
(cd ../loop-now/plugins && npm ci && npm run build)
npm run validate    # node ../loop-now/plugins/host/dist/main.js validate .
```

```
loop-now-plugin-figma/
├── package.json             manifest: pi.skills and loopNow.mcpServers.desktop
├── skills/figma/SKILL.md    instructions for the Agent: which tool, link rules, what to do when it cannot connect
└── test/
    ├── plugin.test.ts       manifest and Skill conventions; loading, calls, disconnects and reconnects in a real Pi
    ├── fake-figma.ts        fake desktop MCP server (streamable HTTP)
    └── fixtures/offline-provider.ts  offline model for the tests
```

## License

Apache-2.0
