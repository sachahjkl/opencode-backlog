# opencode-backlog

`opencode-backlog` gives an OpenCode 2 agent a persistent project backlog. It also displays that backlog in the TUI sidebar.

Each project stores its backlog in `BACKLOG.json`. Commit this file when the backlog must follow the project.

## Features

- Store ordered tasks with a title and optional notes.
- Track `todo`, `doing`, and `done` states.
- Let the agent add, update, move, reorder, list, and remove tasks.
- Refresh the read-only sidebar when `BACKLOG.json` changes.
- Browse tasks from the command palette or with `/backlog` and `/tasks`.
- View task details and change task states from the TUI.

## Install From This Repository

Build the package:

```sh
npm install
npm run build
```

Add the server entrypoint to the project configuration. Replace the path if this repository is elsewhere.

`opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-backlog/dist/index.js"]
}
```

Add the TUI entrypoint to the CLI configuration.

`~/.config/opencode/cli.json`:

```json
{
  "plugins": ["/absolute/path/to/opencode-backlog/dist/tui.js"]
}
```

Restart OpenCode after changing a local package dependency.

## Install With Nix

The default flake package contains the compiled plugin and its runtime dependencies.

```sh
nix build github:sachahjkl/opencode-backlog
```

Use these entrypoints in generated OpenCode configuration:

```text
${package}/lib/opencode-backlog/dist/index.js
${package}/lib/opencode-backlog/dist/tui.js
```

## Agent Tools

- `backlog_list` lists all tasks, or only tasks in one requested state.
- `backlog_add` adds a task at an optional state and position.
- `backlog_update` changes a title or notes.
- `backlog_move` changes a state or a zero-based position.
- `backlog_remove` permanently removes a task.

## File Format

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

Items stay grouped by state. Their array order defines their order inside each state.

## Compatibility

This package targets the OpenCode 2 beta plugin API. It currently uses `@opencode-ai/plugin` version `0.0.0-beta-17927`.
