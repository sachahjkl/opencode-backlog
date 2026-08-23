# opencode-backlog

A persistent project backlog for OpenCode V2 agents and the TUI.

`opencode-backlog` gives the agent tools to manage project tasks. It also adds an interactive backlog to the OpenCode sidebar and command palette.

![Backlog sidebar in OpenCode](docs/images/opencode-backlog.jpg)

## What It Does

The plugin stores tasks in `BACKLOG.json` at the project root. Each task has a title, optional notes, and one Kanban state:

- `todo`
- `doing`
- `done`

The server plugin lets the agent list, add, edit, move, reorder, and remove tasks. The TUI plugin provides:

- A live backlog summary below the sidebar context.
- A `Browse backlog` command in the command palette.
- `/backlog` and `/tasks` slash commands.
- Task details and status changes from the TUI.

## Requirements

- OpenCode V2 with the beta plugin API.
- Nix with flakes enabled.

The Nix development shell supplies Node.js 24 and npm.

The plugin currently targets `@opencode-ai/plugin@0.0.0-beta-17927`.

## Install With Nix

Build the package:

```sh
nix build github:sachahjkl/opencode-backlog
realpath result
```

The result contains two plugin entrypoints:

```text
result/lib/opencode-backlog/dist/index.js
result/lib/opencode-backlog/dist/tui.js
```

Add the server entrypoint to `opencode.jsonc`. Replace `/nix/store/...` with the path printed by `realpath result`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/nix/store/...-opencode-backlog-0.1.0/lib/opencode-backlog/dist/index.js"
  ]
}
```

Add the TUI entrypoint to `~/.config/opencode/cli.json`:

```json
{
  "plugins": [
    "/nix/store/...-opencode-backlog-0.1.0/lib/opencode-backlog/dist/tui.js"
  ]
}
```

Restart the OpenCode service after the first installation:

```sh
opencode2 service restart
```

Reopen the TUI to load the TUI plugin.

## Install From Source

Clone the repository and install its locked dependencies inside the Nix development shell:

```sh
git clone https://github.com/sachahjkl/opencode-backlog.git
cd opencode-backlog
nix develop -c npm ci
nix develop -c npm run build
```

Configure the generated entrypoints with absolute paths:

```text
/absolute/path/to/opencode-backlog/dist/index.js
/absolute/path/to/opencode-backlog/dist/tui.js
```

Use the same `opencode.jsonc` and `cli.json` structure shown in the Nix installation.

## Use The Backlog

Ask the agent to manage tasks in normal language:

```text
Add a todo task to document the release process.
Move the release task to doing.
List only the todo tasks.
Mark the current task as done.
```

Open the command palette and select `Browse backlog` to inspect tasks. Select a task to view its ID, notes, and current state. Then select its new state.

Run `/backlog` or `/tasks` to open the same browser directly.

## Agent Tools

| Tool | Purpose |
| --- | --- |
| `backlog_list` | List all tasks or filter by `todo`, `doing`, or `done`. |
| `backlog_add` | Add a task at an optional state and position. |
| `backlog_update` | Change a task title or notes. |
| `backlog_move` | Change a task state or position. |
| `backlog_remove` | Permanently remove a task. |

The agent receives task IDs from `backlog_list` and from each mutation result.

## Backlog File

The plugin creates `BACKLOG.json` when the first task is added:

```json
{
  "version": 1,
  "items": [
    {
      "id": "c50437e3-2a57-424d-9257-32ec432145a9",
      "title": "Add invoice search",
      "notes": "Search by customer name and invoice number.",
      "status": "doing"
    }
  ]
}
```

Items stay grouped by state. Their array order defines their position inside each state.

Commit `BACKLOG.json` when the backlog must follow the project. Ignore it when the backlog must remain local.

## Verify The Installation

List active server plugins:

```sh
opencode2 api get /api/plugin
```

The response must include `opencode.backlog`.

Open the command palette in the TUI. The `Browse backlog` command confirms that the TUI entrypoint loaded.

## Development

Run all development commands through Nix:

```sh
nix develop -c npm run check
nix develop -c npm test
nix flake check --print-build-logs
```

`BACKLOG.json` is not required by the test suite.

## Compatibility

This project targets OpenCode V2. The V2 plugin API is beta and can change between OpenCode releases.

Match the plugin API version in `package.json` with the OpenCode release that loads the plugin.
