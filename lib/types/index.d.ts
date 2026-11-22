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
import type { Context } from 'cordis';
import z from 'schemastery';
export declare const name = "@dsh-external/dsh-tool-gate";
export declare const inject: string[];
/** 默认闸门名单：super-injector 的 18 个 dev_* 开发工具。 */
export declare const DEFAULT_GATE_TOOLS: string[];
export interface Config {
    /** 保留这些预设的开发工具；其余预设一律被闸门挡住。 */
    allowPresets: string[];
    /** 被挡住的全局工具名（默认 super-injector 的 dev_* 全家桶）。 */
    gateTools: string[];
    /** 只记录将要挡住什么、不真的施加限制（排查用）。 */
    dryRun: boolean;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
