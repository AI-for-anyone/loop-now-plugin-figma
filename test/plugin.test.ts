// 清单与 Skill 的约定；按平台的写法生成 mcp.json，在真实的 Pi（RPC 模式、Loop Now 的启动参数）里加载 Skill 与假的 Figma 桌面版 MCP 服务器，
// 用进程内的离线模型（fixtures/offline-provider.ts）发出工具调用。没有可用的 Pi 时跳过真实 Pi 的部分（LOOP_NOW_TEST_PI_ROOT 指定 Pi 包目录）。

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { FakeFigma, TOOLS } from './fake-figma.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const skillsDir = path.join(root, 'skills')
const skillFile = path.join(skillsDir, 'figma/SKILL.md')
const provider = fileURLToPath(new URL('./fixtures/offline-provider.ts', import.meta.url))
const piRoot = process.env.LOOP_NOW_TEST_PI_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent'
const piCli = path.join(piRoot, 'dist/bundle/cli.js')
const noPi = !existsSync(piCli) && `找不到 ${piCli}`

/** 平台合并后的服务器名：插件 id + "-" + 清单里的名字；Pi 的工具名把 - 换成 _。 */
const SERVER = 'figma-desktop'
const PREFIX = 'mcp__figma_desktop__'

/**
 * 与服务端 AgentAssets 合并写入 Agent 的 Pi 目录 mcp.json 相同：条目原样（这个条目没有占位符，也没有相对路径的 command），
 * 键为 <插件 id>-<名字>。测试把 url 换成假服务器的地址，其余不动。
 */
function mcpJson(url: string): { mcpServers: Record<string, unknown> } {
  const servers: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(pkg.loopNow.mcpServers as Record<string, Record<string, unknown>>)) {
    servers[`${pkg.loopNow.id}-${name}`] = { ...entry, url }
  }
  return { mcpServers: servers }
}

type Rec = { type?: string; id?: string; method?: string; message?: string; data?: { messages: Message[] } }
type Message = { role: string; toolName?: string; isError?: boolean; content: { type: string; text?: string }[] }
type Turn = { turn: number; systemPrompt?: string; tools: string[] }

/** 一个 Pi 进程：参数照 Loop Now 的 piArgs 与 pluginArgs（--no-skills --no-extensions，插件的 --skill 与 -e builtin:mcp）。 */
async function startPi(o: { url: string; calls: ({ name: string; arguments: Record<string, unknown> } | null)[] }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'loop-now-figma-'))
  const agentDir = path.join(dir, 'pi')
  mkdirSync(agentDir)
  writeFileSync(path.join(agentDir, 'mcp.json'), JSON.stringify(mcpJson(o.url), null, 2))
  const report = path.join(dir, 'report.jsonl')
  const flags = ['--mode', 'rpc', '--no-approve', '--offline', '--no-skills', '--no-extensions', '--no-prompt-templates', '--no-themes']
  flags.push('--skill', skillsDir, '-e', 'builtin:mcp', '-e', provider, '--provider', 'test-offline', '--model', 'fixture', '--session-dir', path.join(dir, 'sessions'))
  const child = spawn(process.execPath, [piCli, ...flags], {
    cwd: dir,
    env: { HOME: dir, PATH: '/usr/bin:/bin', PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_TEST_TOOL_CALLS: JSON.stringify(o.calls), PI_TEST_REPORT: report },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  const records: Rec[] = []
  const waiters: { pred: (r: Rec) => boolean; resolve: (r: Rec) => void }[] = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    let r: Rec
    try {
      r = JSON.parse(line)
    } catch {
      return
    }
    records.push(r)
    for (const w of [...waiters]) if (w.pred(r)) waiters.splice(waiters.indexOf(w), 1) && w.resolve(r)
  })
  const waitFor = (pred: (r: Rec) => boolean) =>
    Promise.race([
      new Promise<Rec>((resolve) => waiters.push({ pred, resolve })),
      exited.then(() => Promise.reject(new Error(`Pi 提前退出：${stderr.slice(0, 1500)}`))),
    ])
  const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`)
  let n = 0
  return {
    records,
    /** 发一条提示，等这一轮结束。 */
    async prompt(): Promise<void> {
      const ended = waitFor((r) => r.type === 'agent_end')
      send({ id: `p${++n}`, type: 'prompt', message: 'go' })
      await ended
    },
    async messages(): Promise<Message[]> {
      const reply = waitFor((r) => r.id === 'm')
      send({ id: 'm', type: 'get_messages' })
      return (await reply).data!.messages
    },
    turns(): Turn[] {
      return existsSync(report) ? readFileSync(report, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Turn) : []
    },
    async close(): Promise<void> {
      child.kill('SIGTERM')
      await exited
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const results = (messages: Message[]) => messages.filter((m) => m.role === 'toolResult')
const text = (m: Message) => m.content.map((c) => c.text ?? '').join('\n')

/** 一个刚才还在听、现在没人听的本机端口。 */
async function closedPort(): Promise<number> {
  const f = await FakeFigma.start()
  const port = f.port
  await f.close()
  return port
}

describe('清单与 Skill', () => {
  it('只有 Agent 半边：一个 Skill 目录和 Figma 桌面版的 MCP 服务器，没有平台半边与权限', () => {
    const ln = pkg.loopNow
    assert.equal(ln.id, 'figma')
    assert.equal(pkg.version, '0.1.0')
    for (const key of ['platform', 'permissions', 'events', 'configSchema', 'accounts', 'bin']) assert.equal(ln[key], undefined, key)
    assert.deepEqual(pkg.pi, { skills: ['./skills'] })
    assert.deepEqual(Object.keys(ln.mcpServers), ['desktop'])
    const entry = ln.mcpServers.desktop
    assert.equal(entry.url, 'http://127.0.0.1:3845/mcp')
    assert.equal(entry.command, undefined)
    assert.equal(entry.exposure, 'direct')
    assert.match(entry.description, /Figma 桌面版/)
    assert.match(entry.description, /开启 desktop MCP server/)
    assert.equal(JSON.stringify(entry).includes('${'), false, '没有占位符：合并写入时原样不变')
    assert.equal(pkg.dependencies, undefined, '没有运行依赖')
  })

  it('SKILL.md 的 frontmatter 合 Agent Skills 规范，写明工具前缀、链接规则与连不上时怎么办', () => {
    const raw = readFileSync(skillFile, 'utf8')
    const m = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(raw)
    assert.ok(m, 'frontmatter 只有 name 与 description')
    assert.equal(m![1], 'figma')
    assert.match(m![1]!, /^[a-z0-9]+(-[a-z0-9]+)*$/)
    assert.ok(m![2]!.length <= 1024)
    assert.match(m![2]!, new RegExp(PREFIX))
    for (const tool of ['get_design_context', 'get_metadata', 'get_screenshot', 'get_variable_defs', 'get_figjam', 'get_code_connect_map']) assert.match(raw, new RegExp(`\`${tool}\``), tool)
    assert.match(raw, /`node-id=12-345` → `12:345`/)
    assert.match(raw, /\/branch\//)
    assert.match(raw, /Enable desktop MCP server/)
    assert.match(raw, /Dev 或 Full 席位/)
    assert.match(raw, /不能在画布上创建或修改/)
  })
})

describe('在真实的 Pi 里', { skip: noPi }, () => {
  it('Skill 列进系统提示；桌面版服务器的工具以 mcp__figma_desktop__ 直接出现，调用到达服务器', { timeout: 60_000 }, async () => {
    const figma = await FakeFigma.start()
    const pi = await startPi({
      url: figma.url,
      calls: [
        { name: `${PREFIX}get_metadata`, arguments: { nodeId: '12:345' } },
        { name: `${PREFIX}get_design_context`, arguments: { nodeId: '12:345', clientFrameworks: 'react' } },
      ],
    })
    try {
      await pi.prompt()
      const first = pi.turns()[0]!
      for (const t of TOOLS) assert.ok(first.tools.includes(`${PREFIX}${t.name}`), `${t.name} 不在 ${first.tools.join(', ')}`)
      assert.match(first.systemPrompt ?? '', /figma/)
      assert.ok((first.systemPrompt ?? '').includes(skillFile), '系统提示里有 SKILL.md 的位置')
      assert.ok((first.systemPrompt ?? '').includes('读取 Figma 设计稿'), '系统提示里有 Skill 的说明')

      const r = results(await pi.messages())
      assert.deepEqual(r.map((m) => [m.toolName, m.isError ?? false, text(m)]), [
        [`${PREFIX}get_metadata`, false, 'fake get_metadata for 12:345'],
        [`${PREFIX}get_design_context`, false, 'fake get_design_context for 12:345'],
      ])
      assert.deepEqual(figma.calls, [
        { name: 'get_metadata', arguments: { nodeId: '12:345' } },
        { name: 'get_design_context', arguments: { nodeId: '12:345', clientFrameworks: 'react' } },
      ])
    } finally {
      await pi.close()
      await figma.close()
    }
  })

  it('Pi 启动时桌面版没开：没有 Figma 工具、Pi 报一次连不上；之后开了也要等 Pi 下次启动', { timeout: 60_000 }, async () => {
    const port = await closedPort()
    const url = `http://127.0.0.1:${port}/mcp`
    const pi = await startPi({ url, calls: [] })
    let figma: FakeFigma | null = null
    try {
      await pi.prompt()
      assert.equal(pi.turns()[0]!.tools.some((t) => t.startsWith(PREFIX)), false)
      assert.ok((pi.turns()[0]!.systemPrompt ?? '').includes(skillFile), 'Skill 仍在，Agent 能照它告诉用户怎么做')
      const notice = pi.records.find((r) => r.type === 'extension_ui_request' && r.method === 'notify' && r.message?.includes(SERVER))
      assert.ok(notice, JSON.stringify(pi.records.filter((r) => r.type === 'extension_ui_request')))
      assert.match(notice!.message!, /MCP servers need attention/)

      // 同一个 Pi 里不会自己重连：工具仍然没有。
      figma = await FakeFigma.start(port)
      await pi.prompt()
      assert.equal(pi.turns()[1]!.tools.some((t) => t.startsWith(PREFIX)), false)
      assert.deepEqual(figma.methods, [])
    } finally {
      await pi.close()
    }
    // Pi 重新启动（平台空闲回收后的下一条消息）：连上了。
    const again = await startPi({ url, calls: [] })
    try {
      await again.prompt()
      assert.ok(again.turns()[0]!.tools.includes(`${PREFIX}get_design_context`))
    } finally {
      await again.close()
      await figma?.close()
    }
  })

  it('用着用着桌面版关了：调用报错；重新开启后下一次调用自动重连', { timeout: 60_000 }, async () => {
    let figma = await FakeFigma.start()
    const port = figma.port
    const call = { name: `${PREFIX}get_metadata`, arguments: { nodeId: '1:2' } }
    const pi = await startPi({ url: figma.url, calls: [call, null, call, null, call, null] })
    try {
      await pi.prompt()
      await figma.close()
      await pi.prompt()
      figma = await FakeFigma.start(port)
      await pi.prompt()
      const r = results(await pi.messages())
      assert.deepEqual(
        r.map((m) => m.isError ?? false),
        [false, true, false],
        JSON.stringify(r.map(text)),
      )
      assert.equal(text(r[2]!), 'fake get_metadata for 1:2')
    } finally {
      await pi.close()
      await figma.close()
    }
  })
})
