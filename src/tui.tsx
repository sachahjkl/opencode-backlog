import { watch, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import {
  BACKLOG_FILE,
  EMPTY_BACKLOG,
  STATUSES,
  moveItem,
  type Backlog,
  type BacklogItem,
  type Status,
} from "./backlog.js"
import { readBacklog, readBacklogSync, updateBacklog } from "./store.js"

interface BacklogSnapshot {
  backlog: Backlog
  error?: string
}

interface ViewState {
  directories: Record<string, BacklogSnapshot>
}

const EMPTY_SNAPSHOT: BacklogSnapshot = { backlog: EMPTY_BACKLOG }

function statusLabel(status: Status): string {
  if (status === "todo") return "Todo"
  if (status === "doing") return "Doing"
  return "Done"
}

function BacklogView(props: { context: Plugin.Context; directory: string; view: ViewState }) {
  const theme = props.context.theme
  const snapshot = createMemo(() => props.view.directories[props.directory] ?? EMPTY_SNAPSHOT)
  const backlog = createMemo(() => snapshot().backlog)
  const error = createMemo(() => snapshot().error)

  const color = (status: Status) => {
    if (status === "doing") return theme.text.feedback.warning.default
    if (status === "done") return theme.text.feedback.success.default
    return theme.text.subdued
  }

  return (
    <box>
      <text fg={theme.text.default}>
        <b>Backlog</b>
      </text>
      <Show when={error()}>
        {(message) => <text fg={theme.text.feedback.error.default}>{message()}</text>}
      </Show>
      <Show when={!error() && backlog().items.length === 0}>
        <text fg={theme.text.subdued}>No tasks</text>
      </Show>
      <For each={STATUSES}>
        {(status) => {
          const items = createMemo(() => backlog().items.filter((item) => item.status === status))
          return (
            <Show when={items().length > 0}>
              <box marginTop={1}>
                <text fg={color(status)}>
                  <b>{statusLabel(status)}</b> ({items().length})
                </text>
                <For each={items()}>
                  {(item) => (
                    <box flexDirection="row" gap={1} minWidth={0}>
                      <text fg={color(status)} flexShrink={0}>
                        {status === "done" ? "✓" : status === "doing" ? "●" : "○"}
                      </text>
                      <text fg={theme.text.default} wrapMode="none" truncate flexGrow={1} minWidth={0}>
                        {item.title}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          )
        }}
      </For>
    </box>
  )
}

function taskDetails(item: BacklogItem): string {
  return [`Status: ${statusLabel(item.status)}`, `ID: ${item.id}`, "", item.notes ?? "No notes"].join("\n")
}

async function browseBacklog(context: Plugin.Context): Promise<void> {
  const route = context.ui.router.current()
  const location = route.type === "session" ? context.data.session.get(route.sessionID)?.location : context.location
  const directory = location?.directory ?? context.data.location.default().directory
  const path = join(directory, BACKLOG_FILE)
  const backlog = await readBacklog(path)

  if (backlog.items.length === 0) {
    await context.ui.dialog.alert({ title: "Backlog", message: "No tasks" })
    return
  }

  const id = await context.ui.dialog.select({
    title: "Backlog",
    placeholder: "Select a task",
    options: backlog.items.map((item) => ({
      title: item.title,
      value: item.id,
      ...(item.notes === undefined ? {} : { description: item.notes }),
      category: statusLabel(item.status),
    })),
  })
  if (!id) return

  const item = backlog.items.find((candidate) => candidate.id === id)
  if (!item) return
  await context.ui.dialog.alert({ title: item.title, message: taskDetails(item) })

  const status = await context.ui.dialog.select<Status>({
    title: `Change status: ${item.title}`,
    current: item.status,
    options: STATUSES.map((candidate) => ({
      title: statusLabel(candidate),
      value: candidate,
      ...(candidate === item.status ? { description: "Current status" } : {}),
    })),
  })
  if (!status || status === item.status) return

  await updateBacklog(path, (current) => ({
    version: 1,
    items: moveItem(current.items, item.id, status, undefined),
  }))
  context.ui.toast.show({ message: `Moved "${item.title}" to ${statusLabel(status)}.`, variant: "success" })
}

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "backlog.browse",
        title: "Browse backlog",
        description: "View backlog tasks and change their status",
        group: "Backlog",
        palette: true,
        slash: { name: "backlog", aliases: ["tasks"] },
        async run() {
          try {
            await browseBacklog(props.context)
          } catch (cause) {
            props.context.ui.toast.show({
              message: cause instanceof Error ? cause.message : String(cause),
              variant: "error",
            })
          }
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "opencode.backlog.tui",
  setup(context) {
    const watchers = new Map<string, FSWatcher>()
    const [view, updateView] = context.storage.memory<ViewState>("view", {
      initial: { directories: {} },
    })
    const releaseCommands = context.ui.slot({
      append: "app",
      render: () => <Commands context={context} />,
    })

    const refreshDirectory = (directory: string) => {
      try {
        const backlog = readBacklogSync(join(directory, BACKLOG_FILE))
        updateView((draft) => {
          draft.directories[directory] = { backlog }
        })
      } catch (cause) {
        updateView((draft) => {
          draft.directories[directory] = {
            backlog: EMPTY_BACKLOG,
            error: cause instanceof Error ? cause.message : String(cause),
          }
        })
      }
      context.renderer.requestRender()
    }

    const watchDirectory = (directory: string) => {
      if (watchers.has(directory)) return
      refreshDirectory(directory)
      const watcher = watch(directory, { persistent: false }, (_event, filename) => {
        if (!filename || filename.toString() === BACKLOG_FILE) refreshDirectory(directory)
      })
      watchers.set(directory, watcher)
    }

    const releaseSlot = context.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        const directory = context.data.session.get(props.sessionID)?.location.directory
        if (!directory) return null
        watchDirectory(directory)
        return <BacklogView context={context} directory={directory} view={view} />
      },
    })

    return () => {
      releaseSlot()
      releaseCommands()
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
    }
  },
})
