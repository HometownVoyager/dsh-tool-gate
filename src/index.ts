/**
 * @dsh-external/dsh-tool-gate —— 宿主侧「工具闸门」。
 *
 * 问题：super-injector 的 dev_* 开发工具注册进全局 tools 层，于是每个预设的
 * 会话（小说创作、语言学习……）都能看到并调用注入器、改 profile patch、
 * 热重载插件——工具目录被稀释，权限也不该这么宽。
 *
 * 做法（每一处都对照过源码，不是想当然）：
 * - `agent/created` 监听器的 `this` 是 **agent 载体**，不是 context：agent-loop 用
 *   `agentCarrier(agent) = scopeTarget(agent, agent)` 派发（packages/core/agent/src/dispatch.ts:94）。
 * - agent 对象自带 agent-scoped context：`readonly ctx: Context`
 *   （packages/core/agent/src/runtime-types.ts:174）——`tools.restrict()` 要的正是
 *   这个"scoped context"（packages/core/tools/src/index.ts:1062 的报错文案直接写
 *   `agent.ctx`），服务方法经 ctx 调用时 this 会重绑到该 ctx（vendor/cordis
 *   src/utils.ts:158-160 的 shadow 机制）。
 * - 预设 id 用 `agentPresets.composedPreset(agentCtx)` 读出：它按 scope 链找
 *   standing mount（packages/preset/agent-presets/src/index.ts）。
 *
 * 于是：不是白名单预设的 agent，在**它自己的 ctx** 上 `tools.restrict({ deny })`——
 * 工具目录里直接消失，而不是执行时才拒绝。
 *
 * 边界（刻意取舍，写清楚避免误解）：
 * - 限制只覆盖**施加时刻已注册**的全局工具名；此后新注入的全局工具不在名单里。
 *   宁可漏挡一次，也不因为某个名字还不存在而让 restrict 抛错、把 agent 创建搞崩。
 * - 未解析出预设（`composedPreset` 返回 undefined，例如无 roster 的部署）**不施加限制**
 *   （fail-open）：本插件是最小权限措施，不是安全边界。
 * - 只作用于**新创建**的 agent；已在运行的会话不受影响（新会话或重启后生效）。
 * - 整个处理体包在 try/catch 里：闸门绝不允许因为自身异常打断 agent 创建。
 * - 每次决策追加一行到 `%TEMP%\dsh-tool-gate.log`，出问题可回溯。
 */
import type { Context } from 'cordis'
import z from 'schemastery'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const name = '@dsh-external/dsh-tool-gate'
export const inject = ['tools']

const LOG = join(tmpdir(), 'dsh-tool-gate.log')

/** 决策审计日志；日志写不进去也绝不影响闸门本身。 */
function audit(line: string): void {
  const entry = `${new Date().toISOString()} ${line}\n`
  try {
    if (statSync(LOG).size > 256 * 1024) writeFileSync(LOG, entry, 'utf8')
    else appendFileSync(LOG, entry, 'utf8')
  } catch {
    try { writeFileSync(LOG, entry, 'utf8') } catch { /* 宿主不可写时静默 */ }
  }
}

/** 默认闸门名单：super-injector 的 18 个 dev_* 开发工具。 */
export const DEFAULT_GATE_TOOLS = [
  'dev_inject_plugin',
  'dev_uninject_plugin',
  'dev_install_package',
  'dev_reload_package',
  'dev_injected_list',
  'dev_plugin_status',
  'dev_self_test',
  'dev_fix_patch',
  'dev_heal_links',
  'dev_clear_routes',
  'dev_scaffold_plugin',
  'dev_build_plugin',
  'dev_release_plugin',
  'dev_stage_add',
  'dev_stage_call',
  'dev_stage_list',
  'dev_stage_promote',
  'dev_stage_demote',
]

export interface Config {
  /** 保留这些预设的开发工具；其余预设一律被闸门挡住。 */
  allowPresets: string[]
  /** 被挡住的全局工具名（默认 super-injector 的 dev_* 全家桶）。 */
  gateTools: string[]
  /** 只记录将要挡住什么、不真的施加限制（排查用）。 */
  dryRun: boolean
}

export const Config: z<Config> = z.object({
  allowPresets: z.array(z.string()).default(['cordis', 'prompt-writing']),
  gateTools: z.array(z.string()).default(DEFAULT_GATE_TOOLS),
  dryRun: z.boolean().default(false),
})

interface ToolService {
  get(name: string, scope?: object): unknown
  restrict(filter: { allow?: string[]; deny?: string[] }): () => void
}
interface AgentLike {
  readonly id?: string
  readonly ctx?: Context & { tools?: ToolService; get(name: string): unknown }
}
interface PresetService {
  composedPreset(ctx: Context): string | undefined
}

export function apply(ctx: Context, config: Config): void {
  const allow = new Set(config.allowPresets)
  const gate = [...config.gateTools]
  audit(`plugin loaded; allow=[${[...allow].join(', ')}] gate=${gate.length} tools dryRun=${config.dryRun}`)

  const handler = function (this: unknown, payload?: { agent?: AgentLike }): void {
    try {
      const agent = payload?.agent
      const agentCtx = agent?.ctx
      const who = String(agent?.id ?? '?')
      if (agentCtx === undefined) { audit(`agent=${who} 事件未带 agent.ctx，跳过`); return }
      const tools = (agentCtx.tools ?? agentCtx.get('tools')) as ToolService | undefined
      if (tools === undefined || typeof tools.restrict !== 'function') {
        audit(`agent=${who} 该 ctx 无 tools 服务，跳过`)
        return
      }
      const presets = ctx.get('agentPresets') as PresetService | undefined
      const preset = presets?.composedPreset?.(agentCtx)
      if (preset === undefined) { audit(`agent=${who} 未解析出预设（fail-open，不施加限制）`); return }
      if (allow.has(preset)) { audit(`agent=${who} 预设=${preset} 在白名单内，放行`); return }
      // 只否决"此刻真的存在"的全局工具名：restrict() 对未知名字会抛错。
      const known = gate.filter(name => tools.get(name) !== undefined)
      if (known.length === 0) { audit(`agent=${who} 预设=${preset} 无待挡工具`); return }
      if (config.dryRun) {
        audit(`agent=${who} 预设=${preset} dry-run：将挡住 ${known.join(', ')}`)
        ctx.logger?.info?.('[tool-gate] dry-run：预设 "%s" 将被挡住 %d 个工具', preset, known.length)
        return
      }
      tools.restrict({ deny: known })
      audit(`agent=${who} 预设=${preset} 已挡住 ${known.length} 个：${known.join(', ')}`)
      ctx.logger?.info?.('[tool-gate] 预设 "%s" 已挡住 %d 个开发工具', preset, known.length)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      audit(`处理 agent/created 时异常（已吞掉，不影响该 agent）：${message}`)
      ctx.logger?.warn?.('[tool-gate] 处理 agent/created 异常：%s', message)
    }
  }

  ctx.on('agent/created' as never, handler as never)
}
