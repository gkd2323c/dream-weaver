# Dream Weaver

A Hanako plugin that consolidates memories through simulated "dreaming" — like how human brains process daily experiences during sleep.

## How it works

Every night (default: 03:00), the plugin triggers a dream session where Hanako:

1. **Scans** compiled memory (`memory.md`), session summaries (40+ items), fact-store (100+ tagged facts), and full conversation logs
2. **Discovers** patterns, connections, consolidations, and questions across all memory layers
3. **Records** each insight with an importance score (1-10)
4. **Edits** memory based on findings — pins high-value insights, injects facts into the fact-store, updates project memory
5. **Wakes up** — clears the working buffer, writes a morning state file, updates session state, and adds new heartbeat checks

## Tools

| Tool | Description |
|------|-------------|
| `dream-start` | Begin a dream session. Scans all memory sources and returns a material inventory |
| `dream-insight` | Record a single insight (consolidation / pattern / connection / question / observation / prune) |
| `dream-complete` | End the dream. Optionally auto-consolidate and run the awakening ritual |
| `dream-edit-memory` | Explicitly edit memories: pin, consolidate, add-fact, update-soul, archive-log, or mark for pruning |
| `dream-read-session` | Read session summaries, full conversation logs, or search the fact-store |
| `dream-journal` | Query dream history — list, detail, stats, or latest |

## Insight types

| Type | Meaning |
|------|---------|
| `consolidation` | Merge related memories into a unified concept |
| `pattern` | A recurring sequence or behavior |
| `connection` | A link between seemingly unrelated topics |
| `question` | An open question worth pursuing |
| `observation` | A simple observation, not yet a pattern |
| `prune` | Suggest forgetting low-value information |

## Installation

1. Copy the `dream-weaver` folder to `{HANA_HOME}/plugins/`
2. Or drag-and-drop the folder into Settings → Plugins
3. Enable full-access plugins in settings (required for lifecycle management)
4. The plugin activates automatically on startup

## Configuration

Configure via plugin settings:

- `dreamTime` — Daily dream time (default: `03:00`)
- `maxMemories` — Max memories per dream (default: `30`)
- `dreamReportToUser` — Report dream results to user (default: `true`)
- `autoDream` — Enable automatic daily dreaming (default: `true`)
- `workspaceDir` — Optional workspace directory for reading/writing MEMORY.md, SOUL.md, working-buffer.md, etc.

## Filesystem access

The plugin reads from Hanako's framework memory (agent memory directory, fact-store, session files) automatically.

Optional workspace operations (clearing working-buffer, writing waking-state.md, updating MEMORY.md/SOUL.md) require setting `workspaceDir` in the plugin config.

## License

MIT
