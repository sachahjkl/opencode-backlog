import { randomUUID } from "node:crypto"
import { watch } from "node:fs"
import { join } from "node:path"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
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

type BrowseAction = "details" | "status" | "edit" | "delete"

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

function BacklogView(props: { context: Plugin.Context; directory: string }) {
  const theme = props.context.theme
  const [snapshot, setSnapshot] = createSignal(readSnapshot(props.directory))
  const backlog = createMemo(() => snapshot().backlog)
  const error = createMemo(() => snapshot().error)
  let refresh: ReturnType<typeof setTimeout> | undefined

  const watcher = watch(props.directory, { persistent: false }, () => {
    clearTimeout(refresh)
    refresh = setTimeout(() => {
      setSnapshot(readSnapshot(props.directory))
    }, 50)
  })

  onCleanup(() => {
    clearTimeout(refresh)
    watcher.close()
  })

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
                    <box
                      flexDirection="row"
                      gap={1}
                      minWidth={0}
                      onMouseUp={() => void showTaskDetails(props.context, item)}
                    >
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

function TaskAction(props: {
  context: Plugin.Context
  shortcut: string
  label: string
  danger?: boolean
  run: () => void
}) {
  return (
    <text
      fg={props.danger ? props.context.theme.text.feedback.error.default : props.context.theme.text.subdued}
      onMouseUp={props.run}
    >
      <b>{props.shortcut}</b> {props.label}
    </text>
  )
}

function TaskDetailsDialog(props: { context: Plugin.Context; item: BacklogItem }) {
  const run = (operation: () => Promise<void>) => {
    props.context.ui.dialog.clear()
    void operation().catch((cause) =>
      props.context.ui.toast.show({
        message: cause instanceof Error ? cause.message : String(cause),
        variant: "error",
      }),
    )
  }
  const changeStatus = () => run(() => changeTaskStatus(props.context, props.item))
  const edit = () => run(() => editBacklogItem(props.context, props.item))
  const remove = () => run(() => removeBacklogItem(props.context, props.item))

  onMount(() => props.context.ui.dialog.set({ size: "medium" }))
  props.context.keymap.layer(() => ({
    mode: "modal",
    priority: 100,
    commands: [
      { bind: "c", title: "Change backlog task status", group: "Backlog", run: changeStatus },
      { bind: "e", title: "Edit backlog task", group: "Backlog", run: edit },
      { bind: "d", title: "Delete backlog task", group: "Backlog", run: remove },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text fg={props.context.theme.text.default} wrapMode="word" flexGrow={1}>
          <b>{props.item.title}</b>
        </text>
        <text fg={props.context.theme.text.subdued} onMouseUp={() => props.context.ui.dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={props.context.theme.text.subdued} wrapMode="word">
        {taskDetails(props.item)}
      </text>
      <box flexDirection="row" justifyContent="flex-end" gap={2} paddingBottom={1}>
        <TaskAction context={props.context} shortcut="c" label="status" run={changeStatus} />
        <TaskAction context={props.context} shortcut="e" label="edit" run={edit} />
        <TaskAction context={props.context} shortcut="d" label="delete" danger run={remove} />
      </box>
    </box>
  )
}

function showTaskDetails(context: Plugin.Context, item: BacklogItem): void {
  context.ui.dialog.show(() => <TaskDetailsDialog context={context} item={item} />)
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

async function changeTaskStatus(context: Plugin.Context, item: BacklogItem): Promise<void> {
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

  const { path } = backlogLocation(context)
  await updateBacklog(path, (current) => ({
    version: 1,
    items: moveItem(current.items, item.id, status, undefined),
  }))
  context.ui.toast.show({ message: `Moved "${item.title}" to ${statusLabel(status)}.`, variant: "success" })
}

async function editBacklogItem(context: Plugin.Context, item: BacklogItem): Promise<void> {
  const title = await context.ui.dialog.prompt({
    title: "Edit backlog task",
    placeholder: "Task title",
    value: item.title,
  })
  if (!title?.trim()) return

  const notes = await context.ui.dialog.prompt({
    title: title.trim(),
    description: "Optional notes",
    placeholder: "Leave empty for no notes",
    value: item.notes ?? "",
  })
  if (notes === undefined) return

  const { path } = backlogLocation(context)
  await updateBacklog(path, (current) => ({
    version: 1,
    items: current.items.map((candidate) => {
      if (candidate.id !== item.id) return candidate
      return {
        id: candidate.id,
        title: title.trim(),
        status: candidate.status,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }
    }),
  }))
  context.ui.toast.show({ message: `Updated "${title.trim()}".`, variant: "success" })
}

async function removeBacklogItem(context: Plugin.Context, item: BacklogItem): Promise<void> {
  const confirmed = await context.ui.dialog.confirm({
    title: "Delete backlog task",
    message: item.title,
    label: { confirm: "Delete", cancel: "Cancel" },
  })
  if (!confirmed) return

  const { path } = backlogLocation(context)
  await updateBacklog(path, (current) => ({
    version: 1,
    items: current.items.filter((candidate) => candidate.id !== item.id),
  }))
  context.ui.toast.show({ message: `Deleted "${item.title}".`, variant: "success" })
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
  await changeTaskStatus(context, item)
}

async function browseBacklogWithState(
  context: Plugin.Context,
  setOpen: (open: boolean) => void,
  action: () => BrowseAction = () => "details",
): Promise<void> {
  const { path } = backlogLocation(context)
  const backlog = await readBacklog(path)

  if (backlog.items.length === 0) {
    await context.ui.dialog.alert({ title: "Backlog", message: "No tasks" })
    return
  }

  setOpen(true)
  const id = await context.ui.dialog
    .select({
      title: "Backlog",
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
  const selectedAction = action()
  if (selectedAction === "status") return changeTaskStatus(context, item)
  if (selectedAction === "edit") return editBacklogItem(context, item)
  if (selectedAction === "delete") return removeBacklogItem(context, item)
  showTaskDetails(context, item)
}

function Commands(props: { context: Plugin.Context }) {
  const [browseOpen, setBrowseOpen] = createSignal(false)
  const [browseAction, setBrowseAction] = createSignal<BrowseAction>("details")
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
        run: () => {
          setBrowseAction("details")
          return run(() => browseBacklogWithState(props.context, setBrowseOpen, browseAction))
        },
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
      {
        bind: "c",
        title: "Change selected task status",
        group: "Backlog",
        run() {
          setBrowseAction("status")
          props.context.keymap.dispatch("dialog.select.submit")
        },
      },
      {
        bind: "d",
        title: "Delete selected task",
        group: "Backlog",
        run() {
          setBrowseAction("delete")
          props.context.keymap.dispatch("dialog.select.submit")
        },
      },
      {
        bind: "e",
        title: "Edit selected task",
        group: "Backlog",
        run() {
          setBrowseAction("edit")
          props.context.keymap.dispatch("dialog.select.submit")
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "opencode.backlog.tui",
  setup(context) {
    const releaseCommands = context.ui.slot({
      append: "app",
      render: () => <Commands context={context} />,
    })

    const releaseSlot = context.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        const directory = context.data.session.get(props.sessionID)?.location.directory
        if (!directory) return null
        return <BacklogView context={context} directory={directory} />
      },
    })

    return () => {
      releaseSlot()
      releaseCommands()
    }
  },
})
