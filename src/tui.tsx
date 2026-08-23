import { randomUUID } from "node:crypto"
import { watch, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
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

function statusLabel(status: Status): string {
  if (status === "todo") return "Todo"
  if (status === "doing") return "Doing"
  return "Done"
}

function readSnapshot(directory: string): BacklogSnapshot {
  try {
    return { backlog: readBacklogSync(join(directory, BACKLOG_FILE)) }
  } catch (cause) {
    return {
      backlog: EMPTY_BACKLOG,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

function BacklogView(props: { context: Plugin.Context; snapshot: BacklogSnapshot }) {
  const theme = props.context.theme
  const backlog = () => props.snapshot.backlog
  const error = () => props.snapshot.error

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
  return browseBacklogWithState(context, () => {})
}

function backlogLocation(context: Plugin.Context): { directory: string; path: string } {
  const route = context.ui.router.current()
  const location = route.type === "session" ? context.data.session.get(route.sessionID)?.location : context.location
  const directory = location?.directory ?? context.data.location.default().directory
  return { directory, path: join(directory, BACKLOG_FILE) }
}

async function addBacklogItem(context: Plugin.Context): Promise<void> {
  const title = await context.ui.dialog.prompt({
    title: "New backlog task",
    placeholder: "Task title",
  })
  if (!title?.trim()) return

  const notes = await context.ui.dialog.prompt({
    title: title.trim(),
    description: "Optional notes",
    placeholder: "Leave empty for no notes",
  })
  if (notes === undefined) return

  const item: BacklogItem = {
    id: randomUUID(),
    title: title.trim(),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    status: "todo",
  }
  const { path } = backlogLocation(context)
  await updateBacklog(path, (current) => ({
    version: 1,
    items: moveItem([...current.items, item], item.id, "todo", 0),
  }))
  context.ui.toast.show({ message: `Added "${item.title}".`, variant: "success" })
}

async function moveBacklogItem(context: Plugin.Context): Promise<void> {
  const { path } = backlogLocation(context)
  const backlog = await readBacklog(path)

  if (backlog.items.length === 0) {
    await context.ui.dialog.alert({ title: "Backlog", message: "No tasks" })
    return
  }

  const id = await context.ui.dialog.select({
    title: "Move backlog task",
    placeholder: "Select a task to move",
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

async function browseBacklogWithState(context: Plugin.Context, setOpen: (open: boolean) => void): Promise<void> {
  const { path } = backlogLocation(context)
  const backlog = await readBacklog(path)

  if (backlog.items.length === 0) {
    await context.ui.dialog.alert({ title: "Backlog", message: "No tasks" })
    return
  }

  setOpen(true)
  const id = await context.ui.dialog
    .select({
      title: "Backlog (n: new task)",
      placeholder: "Select a task",
      options: backlog.items.map((item) => ({
        title: item.title,
        value: item.id,
        ...(item.notes === undefined ? {} : { description: item.notes }),
        category: statusLabel(item.status),
      })),
    })
    .finally(() => setOpen(false))
  if (!id) return

  const item = backlog.items.find((candidate) => candidate.id === id)
  if (!item) return
  await context.ui.dialog.alert({ title: item.title, message: taskDetails(item) })
}

function Commands(props: { context: Plugin.Context }) {
  const [browseOpen, setBrowseOpen] = createSignal(false)
  const run = async (operation: () => Promise<void>) => {
    try {
      await operation()
    } catch (cause) {
      props.context.ui.toast.show({
        message: cause instanceof Error ? cause.message : String(cause),
        variant: "error",
      })
    }
  }

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
        run: () => run(() => browseBacklogWithState(props.context, setBrowseOpen)),
      },
      {
        id: "backlog.add",
        title: "Add backlog task",
        description: "Create a Todo task at the top of the backlog",
        group: "Backlog",
        palette: true,
        slash: { name: "backlog-add", aliases: ["task-add"] },
        run: () => run(() => addBacklogItem(props.context)),
      },
      {
        id: "backlog.move",
        title: "Move backlog task",
        description: "Change a backlog task state",
        group: "Backlog",
        palette: true,
        slash: { name: "backlog-move", aliases: ["task-move"] },
        run: () => run(() => moveBacklogItem(props.context)),
      },
    ],
  }))
  props.context.keymap.layer(() => ({
    mode: "modal",
    enabled: browseOpen,
    priority: 100,
    commands: [
      {
        bind: "n",
        title: "New backlog task",
        group: "Backlog",
        run() {
          setBrowseOpen(false)
          return run(() => addBacklogItem(props.context))
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "opencode.backlog.tui",
  setup(context) {
    const snapshots = new Map<string, BacklogSnapshot>()
    const watchers = new Map<string, { watcher: FSWatcher; refresh?: ReturnType<typeof setTimeout> }>()
    const releaseCommands = context.ui.slot({
      append: "app",
      render: () => <Commands context={context} />,
    })

    let releaseSlot = () => {}
    const registerSlot = () =>
      context.ui.slot({
        append: "sidebar.content",
        render: (props) => {
          const directory = context.data.session.get(props.sessionID)?.location.directory
          if (!directory) return null
          if (!snapshots.has(directory)) snapshots.set(directory, readSnapshot(directory))
          if (!watchers.has(directory)) {
            const state: { watcher: FSWatcher; refresh?: ReturnType<typeof setTimeout> } = {
              watcher: watch(directory, { persistent: false }, () => {
                clearTimeout(state.refresh)
                state.refresh = setTimeout(() => {
                  snapshots.set(directory, readSnapshot(directory))
                  releaseSlot()
                  releaseSlot = registerSlot()
                }, 50)
              }),
            }
            watchers.set(directory, state)
          }
          return <BacklogView context={context} snapshot={snapshots.get(directory)!} />
        },
      })
    releaseSlot = registerSlot()

    return () => {
      releaseSlot()
      releaseCommands()
      for (const state of watchers.values()) {
        clearTimeout(state.refresh)
        state.watcher.close()
      }
      watchers.clear()
    }
  },
})
