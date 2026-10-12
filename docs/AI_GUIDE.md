# Nebula Launcher — guide for AI agents

This launcher is built so that an AI agent (Claude Code, Codex, Cursor, Gemini CLI, …) can build and
repair Minecraft modpacks for the user. You never touch raw `.minecraft` folders by hand: use the
launcher tools, they pick compatible versions, resolve dependencies and keep the launcher UI in sync
(the user sees every action live in the "ИИ-мастерская" page).

## Ways to connect

| Way | How |
|-----|-----|
| Built-in chat | Launcher → «ИИ-мастерская». Uses the local Claude Code CLI with only the launcher tools enabled. |
| Claude Code (MCP) | Launcher → ИИ-мастерская → «Подключить» (runs `claude mcp add-json nebula … -s user`). |
| Codex (MCP) | Launcher → ИИ-мастерская → «Подключить» (adds `[mcp_servers.nebula]` to `~/.codex/config.toml`). |
| Any MCP client | stdio server: `<electron.exe> mcp/server.mjs` with env `ELECTRON_RUN_AS_NODE=1` (or `node mcp/server.mjs`). |
| Shell only | `node cli/nebula.js <command>` — same operations, JSON output. |

Data lives in `%APPDATA%\.nebula-launcher` (override with env `NEBULA_HOME`):
`instances/<id>/instance.json` (settings) and `instances/<id>/.minecraft/` (game folder).

## Recommended workflow (MCP tool names)

1. `launcher_info` / `list_instances` — understand what exists.
2. Choose the Minecraft version and loader. The most modded versions: **1.20.1** (Forge, Fabric) and
   **1.21.1** (NeoForge, Fabric). Check with `mod_info(project, instance)` that key mods exist for it.
3. `create_instance(name, mc, loader, memoryMB)`.
4. `search_mods(query, instance)` — results are pre-filtered to the instance's version and loader.
5. `add_mods(instance, [slugs])` — installs the best release version + required dependencies.
6. `check_instance(instance)` → if `missing` is not empty: `fix_missing_dependencies`.
   Remove mods reported as `wrong-loader` or real `conflict`s with `remove_mods`.
7. Optional: `apply_preset` (performance, shaders, qol, map, visual, adventure, tech, magic),
   `write_file` for configs, `update_instance` for RAM / JVM args.
8. `launch_instance` to test; after 30–60 s `get_logs(instance, errorsOnly=true)` shows a crash analysis.

### One-shot: `apply_pack_spec`

```json
{
  "spec": {
    "name": "Техно-выживание",
    "mc": "1.20.1",
    "loader": "fabric",
    "memory": 6144,
    "presets": ["performance", "map"],
    "mods": ["create-fabric", "jei", "appleskin", "jade"],
    "shaders": ["complementary-reimagined"],
    "files": { "options.txt": "lang:ru_ru\nguiScale:3\n" },
    "notes": "Собрано ИИ"
  }
}
```

Pass `"instance": "<id>"` instead of name/mc to extend an existing pack.

## Rules of thumb

- Never mix loaders. Quilt accepts Fabric mods; NeoForge 1.20.1 accepts Forge mods; nothing else crosses.
- Performance: Sodium (Fabric/NeoForge) or Embeddium (Forge), plus Lithium/FerriteCore/ModernFix.
- Shaders: Iris (Fabric/NeoForge) or Oculus (Forge) + a shader pack (`type: "shader"`).
- Fabric mods almost always need `fabric-api` — `add_mods` adds it automatically when declared.
- Respect RAM: ~4 GB for light packs, 6–8 GB for 100+ mods. Check `launcher_info` before going higher.
- Russian language in game: `options.txt` → `lang:ru_ru`.
- Reply to the user in their language (usually Russian) and finish with a short summary.
