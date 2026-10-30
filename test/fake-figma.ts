// 假的 Figma 桌面版 MCP 服务器：streamable HTTP（POST /mcp，JSON 回答），工具名与桌面版相同，参数与返回是简化的。
// 只实现 Pi 连接与调用用到的部分：initialize、notifications/*、tools/list、tools/call；GET（服务器推送流）回 405。

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const NODE = { type: 'object', properties: { nodeId: { type: 'string', description: '节点 id，如 12:345；省略时用桌面版里当前的选中' } } }

export const TOOLS = [
  { name: 'get_design_context', description: 'Design context and code for a layer or selection', inputSchema: { ...NODE, properties: { ...NODE.properties, clientFrameworks: { type: 'string' }, clientLanguages: { type: 'string' } } } },
  { name: 'get_metadata', description: 'XML outline of a selection', inputSchema: NODE },
  { name: 'get_screenshot', description: 'Screenshot of a selection', inputSchema: NODE },
  { name: 'get_variable_defs', description: 'Variables and styles used in a selection', inputSchema: NODE },
  { name: 'get_figjam', description: 'FigJam diagram as XML', inputSchema: NODE },
  { name: 'get_code_connect_map', description: 'Code Connect mappings for selected instances', inputSchema: NODE },
]

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

export class FakeFigma {
  readonly calls: ToolCall[] = []
  readonly methods: string[] = []
  private readonly server: Server

  private constructor() {
    this.server = createServer((req, res) => void this.handle(req, res))
  }

  static async start(port = 0): Promise<FakeFigma> {
    const f = new FakeFigma()
    await new Promise<void>((resolve, reject) => {
      f.server.once('error', reject)
      f.server.listen(port, '127.0.0.1', () => resolve())
    })
    return f
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`
  }

  close(): Promise<void> {
    this.server.closeAllConnections()
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.url !== '/mcp') return void res.writeHead(404).end()
    if (req.method === 'DELETE') return void res.writeHead(200).end()
    if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST, DELETE' }).end()
    let raw = ''
    for await (const chunk of req) raw += chunk
    const m = JSON.parse(raw) as { id?: number | string; method: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } }
    this.methods.push(m.method)
    if (m.id === undefined) return void res.writeHead(202).end() // 通知
    const reply = (result: unknown) => res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fake-session' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }))
    switch (m.method) {
      case 'initialize':
        return reply({ protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Figma Dev Mode MCP (fake)', version: '0.0.0' } })
      case 'tools/list':
        return reply({ tools: TOOLS })
      case 'tools/call': {
        const name = String(m.params?.name)
        const args = m.params?.arguments ?? {}
        this.calls.push({ name, arguments: args })
        if (!TOOLS.some((t) => t.name === name)) return reply({ isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] })
        return reply({ content: [{ type: 'text', text: `fake ${name} for ${String(args.nodeId ?? 'selection')}` }] })
      }
      default:
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } }))
    }
  }
}
