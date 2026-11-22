import z from 'schemastery';
import { appendFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export const name = '@dsh-external/dsh-tool-gate';
export const inject = ['tools'];
const LOG = join(tmpdir(), 'dsh-tool-gate.log');
/** 决策审计日志；日志写不进去也绝不影响闸门本身。 */
function audit(line) {
    const entry = `${new Date().toISOString()} ${line}\n`;
    try {
        if (statSync(LOG).size > 256 * 1024)
            writeFileSync(LOG, entry, 'utf8');
        else
            appendFileSync(LOG, entry, 'utf8');
    }
    catch {
        try {
            writeFileSync(LOG, entry, 'utf8');
        }
        catch { /* 宿主不可写时静默 */ }
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
];
export const Config = z.object({
    allowPresets: z.array(z.string()).default(['cordis', 'prompt-writing']),
    gateTools: z.array(z.string()).default(DEFAULT_GATE_TOOLS),
    dryRun: z.boolean().default(false),
});
export function apply(ctx, config) {
    const allow = new Set(config.allowPresets);
    const gate = [...config.gateTools];
    audit(`plugin loaded; allow=[${[...allow].join(', ')}] gate=${gate.length} tools dryRun=${config.dryRun}`);
    const handler = function (payload) {
        try {
            const agent = payload?.agent;
            const agentCtx = agent?.ctx;
            const who = String(agent?.id ?? '?');
            if (agentCtx === undefined) {
                audit(`agent=${who} 事件未带 agent.ctx，跳过`);
                return;
            }
            const tools = (agentCtx.tools ?? agentCtx.get('tools'));
            if (tools === undefined || typeof tools.restrict !== 'function') {
                audit(`agent=${who} 该 ctx 无 tools 服务，跳过`);
                return;
            }
            const presets = ctx.get('agentPresets');
            const preset = presets?.composedPreset?.(agentCtx);
            if (preset === undefined) {
                audit(`agent=${who} 未解析出预设（fail-open，不施加限制）`);
                return;
            }
            if (allow.has(preset)) {
                audit(`agent=${who} 预设=${preset} 在白名单内，放行`);
                return;
            }
            // 只否决"此刻真的存在"的全局工具名：restrict() 对未知名字会抛错。
            const known = gate.filter(name => tools.get(name) !== undefined);
            if (known.length === 0) {
                audit(`agent=${who} 预设=${preset} 无待挡工具`);
                return;
            }
            if (config.dryRun) {
                audit(`agent=${who} 预设=${preset} dry-run：将挡住 ${known.join(', ')}`);
                ctx.logger?.info?.('[tool-gate] dry-run：预设 "%s" 将被挡住 %d 个工具', preset, known.length);
                return;
            }
            tools.restrict({ deny: known });
            audit(`agent=${who} 预设=${preset} 已挡住 ${known.length} 个：${known.join(', ')}`);
            ctx.logger?.info?.('[tool-gate] 预设 "%s" 已挡住 %d 个开发工具', preset, known.length);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(`处理 agent/created 时异常（已吞掉，不影响该 agent）：${message}`);
            ctx.logger?.warn?.('[tool-gate] 处理 agent/created 异常：%s', message);
        }
    };
    ctx.on('agent/created', handler);
}
//# sourceMappingURL=index.js.map