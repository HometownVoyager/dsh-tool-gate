> **自用声明**：本仓是 [DSH-OrcaMind](https://github.com/HometownVoyager/DSH-OrcaMind) 个人工作区的自研插件独立发布仓，与 deepseek-ai 官方无关。路径按本机硬编码（Windows，工作区根 `D:\Tools\DeepSeek Harness`），不保证开箱即用；`*.local.json` 凭据文件不入库，缺失时按 README 说明重建。

# @dsh-external/dsh-tool-gate

宿主侧工具闸门：按预设白名单对 agent scope 施加 tools.restrict，非白名单预设看不到 dev_* 开发工具

由 dsh-super-injector dev_scaffold_plugin 生成。

## 构建与注入

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
```

本插件已转正为 web profile 的 bundle（package.json 声明 `dsh.bundle.patch` +
根目录 `cordis.patch.yml`），重启后由引导器直接装配，不再依赖注入器热加载。
改动后如需免重启生效，仍可在注入器环境内 `dev_reload_package`；但不要用
`dev_install_package` 重复安装（幂等跳过，无害）。
