// 只用于测试的进程内模型（照 loop-now 的 plugins/host/test/fixtures/pi-offline-provider.ts），不连接任何真实供应商。
// PI_TEST_TOOL_CALLS（JSON 数组 [{name, arguments}]）是前几轮依次发出的工具调用，之后每轮回复 done；
// PI_TEST_REPORT 设置时，每轮把模型收到的系统提示、工具名与消息追加一行写进这个文件。
import { appendFileSync } from 'node:fs'

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const calls = JSON.parse(process.env.PI_TEST_TOOL_CALLS ?? '[]') as { name: string; arguments: Record<string, unknown> }[]

export default function (pi: ExtensionAPI) {
  let turns = 0
  pi.registerProvider('test-offline', {
    baseUrl: 'http://127.0.0.1:9',
    api: 'test-offline',
    apiKey: 'synthetic-only',
    models: [{ id: 'fixture', name: 'Offline fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 }],
    streamSimple(model, context) {
      const call = calls[turns++]
      if (process.env.PI_TEST_REPORT) {
        // Pi 1.4 把系统提示与工具声明放在对话里的 system 消息上（sections、toolsAdded、toolsRemoved），旧版本放在 systemPrompt 与 tools。
        type System = { role: string; content?: unknown; sections?: Record<string, unknown>; toolsAdded?: { name: string }[]; toolsRemoved?: (string | { name: string })[] }
        const system = (context.messages as unknown as System[]).filter((m) => m.role === 'system')
        const tools = new Set((context.tools ?? []).map((t) => t.name))
        for (const m of system) {
          for (const t of m.toolsAdded ?? []) tools.add(t.name)
          for (const t of m.toolsRemoved ?? []) tools.delete(typeof t === 'string' ? t : t.name)
        }
        const systemPrompt = [context.systemPrompt ?? '', ...system.flatMap((m) => [String(m.content ?? ''), ...Object.values(m.sections ?? {}).map(String)])].join('\n')
        appendFileSync(process.env.PI_TEST_REPORT, `${JSON.stringify({ turn: turns, systemPrompt, tools: [...tools], messages: context.messages })}\n`)
      }
      const stream = createAssistantMessageEventStream()
      const message = {
        role: 'assistant' as const,
        content: call ? [{ type: 'toolCall' as const, id: `offline-call-${turns}`, name: call.name, arguments: call.arguments }] : [{ type: 'text' as const, text: 'done' }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: call ? ('toolUse' as const) : ('stop' as const),
        timestamp: Date.now(),
      }
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: message })
        stream.push({ type: 'done', reason: message.stopReason, message })
        stream.end()
      })
      return stream
    },
  })
}
