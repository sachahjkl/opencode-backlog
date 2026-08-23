import { randomUUID } from "node:crypto"
import { watch } from "node:fs"
import { join } from "node:path"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import {
  addCategory,
  BACKLOG_FILE,
  EMPTY_BACKLOG,
  moveItem,
  moveCategory,
  purgeCategory,
  removeCategory,
  renameCategory,
  type Backlog,
  type BacklogItem,
  type Category,
  type Status,
} from "./backlog.js"
import { readBacklog, readBacklogSync, updateBacklog } from "./store.js"

interface BacklogSnapshot {
  backlog: Backlog
  error?: string
}

type BrowseAction = "details" | "status" | "edit" | "delete"

function categoryTitle(categories: readonly Category[], status: Status): string {
  return categories.find((category) => category.id === status)?.title ?? status
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
      <For each={backlog().categories}>
        {(category) => {
          const items = createMemo(() => backlog().items.filter((item) => item.status === category.id))
          return (
            <box marginTop={1}>
              <text fg={theme.text.subdued}>
                <b>{category.title}</b> ({items().length})
              </text>
              <For each={items()}>
                {(item) => (
                  <box minWidth={0} onMouseUp={() => void showTaskDetails(props.context, item, backlog().categories)}>
                    <text fg={theme.text.default} wrapMode="none" truncate flexGrow={1} minWidth={0}>
                      {item.title}
                    </text>
                  </box>
                )}
              </For>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function taskDetails(item: BacklogItem, categories: readonly Category[]): string {
  return [`Category: ${categoryTitle(categories, item.status)}`, `ID: ${item.id}`, "", item.notes ?? "No notes"].join("\n")
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

function TaskDetailsDialog(props: { context: Plugin.Context; item: BacklogItem; categories: readonly Category[] }) {
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
        {taskDetails(props.item, props.categories)}
      </text>
      <box flexDirection="row" justifyContent="flex-end" gap={2} paddingBottom={1}>
        <TaskAction context={props.context} shortcut="c" label="status" run={changeStatus} />
        <TaskAction context={props.context} shortcut="e" label="edit" run={edit} />
        <TaskAction context={props.context} shortcut="d" label="delete" danger run={remove} />
      </box>
    </box>
  )
}

function showTaskDetails(context: Plugin.Context, item: BacklogItem, categories: readonly Category[]): void {
  context.ui.dialog.show(() => <TaskDetailsDialog context={context} item={item} categories={categories} />)
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
  const { path } = backlogLocation(context)
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

  let item: BacklogItem | undefined
  await updateBacklog(path, (current) => {
    const firstCategory = current.categories[0]
    if (!firstCategory) throw new Error("Add a backlog category before adding a task")
    item = {
      id: randomUUID(),
      title: title.trim(),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      status: firstCategory.id,
    }
    return {
      ...current,
      items: moveItem([...current.items, item], item.id, firstCategory.id, 0, current.categories),
    }
  })
  if (!item) throw new Error("Backlog update did not add a task")
  context.ui.toast.show({ message: `Added "${item.title}".`, variant: "success" })
}

async function changeTaskStatus(context: Plugin.Context, item: BacklogItem): Promise<void> {
  const { path } = backlogLocation(context)
  const backlog = await readBacklog(path)
  const status = await context.ui.dialog.select<Status>({
    title: `Change category: ${item.title}`,
    current: item.status,
    options: backlog.categories.map((category) => ({
      title: category.title,
      value: category.id,
      ...(category.id === item.status ? { description: "Current category" } : {}),
    })),
  })
  if (!status || status === item.status) return

  await updateBacklog(path, (current) => ({
    ...current,
    items: moveItem(current.items, item.id, status, undefined, current.categories),
  }))
  context.ui.toast.show({ message: `Moved "${item.title}" to ${categoryTitle(backlog.categories, status)}.`, variant: "success" })
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
    ...current,
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
    ...current,
    items: current.items.filter((candidate) => candidate.id !== item.id),
  }))
  context.ui.toast.show({ message: `Deleted "${item.title}".`, variant: "success" })
}

async function purgeConfirmedCategory(path: string, status: Status, confirmedIDs: readonly string[]): Promise<void> {
  await updateBacklog(path, (current) => {
    const currentIDs = current.items.filter((item) => item.status === status).map((item) => item.id)
    const changed = currentIDs.length !== confirmedIDs.length || currentIDs.some((id) => !confirmedIDs.includes(id))
    if (changed) throw new Error("The category changed. Review its tasks and confirm the purge again.")
    return purgeCategory(current, status)
  })
}

async function purgeBacklogCategory(context: Plugin.Context): Promise<void> {
  const { path } = backlogLocation(context)
  const backlog = await readBacklog(path)
  const status = await context.ui.dialog.select<Status>({
    title: "Purge backlog category",
    placeholder: "Select a category",
    options: backlog.categories.map((category) => {
      const count = backlog.items.filter((item) => item.status === category.id).length
      return {
        title: category.title,
        value: category.id,
        description: `${count} ${count === 1 ? "task" : "tasks"}`,
      }
    }),
  })
  if (!status) return

  const category = backlog.categories.find((candidate) => candidate.id === status)
  if (!category) return
  const taskIDs = backlog.items.filter((item) => item.status === status).map((item) => item.id)
  const count = taskIDs.length
  const confirmed = await context.ui.dialog.confirm({
    title: `Purge ${category.title}`,
    message: `Permanently delete ${count} ${count === 1 ? "task" : "tasks"} from this category?`,
    label: { confirm: "Purge", cancel: "Cancel" },
  })
  if (!confirmed) return

  await purgeConfirmedCategory(path, status, taskIDs)
  context.ui.toast.show({
    message: `Purged ${count} ${count === 1 ? "task" : "tasks"} from ${category.title}.`,
    variant: "success",
  })
}

async function addBacklogCategory(context: Plugin.Context): Promise<void> {
  const title = await context.ui.dialog.prompt({
    title: "New backlog category",
    placeholder: "Category title",
  })
  if (!title?.trim()) return

  const suggestedID = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const id = await context.ui.dialog.prompt({
    title: title.trim(),
    description: "Stable category ID",
    placeholder: "Category ID",
    value: suggestedID,
  })
  if (!id?.trim()) return

  const category: Category = { id: id.trim(), title: title.trim() }
  const { path } = backlogLocation(context)
  await updateBacklog(path, (current) => addCategory(current, category))
  context.ui.toast.show({ message: `Added category "${category.title}".`, variant: "success" })
}

async function renameBacklogCategory(context: Plugin.Context, category: Category): Promise<void> {
  const title = await context.ui.dialog.prompt({
    title: "Rename backlog category",
    placeholder: "Category title",
    value: category.title,
  })
  if (!title?.trim() || title.trim() === category.title) return

  const { path } = backlogLocation(context)
  await updateBacklog(path, (current) => renameCategory(current, category.id, title.trim()))
  context.ui.toast.show({ message: `Renamed category to "${title.trim()}".`, variant: "success" })
}

async function moveBacklogCategory(context: Plugin.Context, category: Category): Promise<void> {
  const { path } = backlogLocation(context)
  const backlog = await readBacklog(path)
  const position = await context.ui.dialog.select<number>({
    title: `Move ${category.title}`,
    placeholder: "Select a position",
    options: backlog.categories.map((candidate, index) => ({
      title: `${index + 1}. ${candidate.title}`,
      value: index,
      ...(candidate.id === category.id ? { description: "Current position" } : {}),
    })),
  })
  if (position === undefined || backlog.categories[position]?.id === category.id) return

  await updateBacklog(path, (current) => moveCategory(current, category.id, position))
  context.ui.toast.show({ message: `Moved category "${category.title}".`, variant: "success" })
}

async function deleteBacklogCategory(context: Plugin.Context, category: Category): Promise<void> {
  const confirmed = await context.ui.dialog.confirm({
    title: "Delete backlog category",
    message: category.title,
    label: { confirm: "Delete", cancel: "Cancel" },
  })
  if (!confirmed) return

  const { path } = backlogLocation(context)
  await updateBacklog(path, (current) => removeCategory(current, category.id))
  context.ui.toast.show({ message: `Deleted category "${category.title}".`, variant: "success" })
}

async function manageBacklogCategories(context: Plugin.Context): Promise<void> {
  const { path } = backlogLocation(context)
  const backlog = await readBacklog(path)
  let addSelection = `__add:${randomUUID()}`
  while (backlog.categories.some((category) => category.id === addSelection)) {
    addSelection = `__add:${randomUUID()}`
  }
  const selection = await context.ui.dialog.select({
    title: "Backlog categories",
    placeholder: "Add or select a category",
    options: [
      { title: "Add category", value: addSelection },
      ...backlog.categories.map((category) => ({
        title: category.title,
        value: category.id,
        description: `${category.id} - ${backlog.items.filter((item) => item.status === category.id).length} tasks`,
      })),
    ],
  })
  if (!selection) return
  if (selection === addSelection) return addBacklogCategory(context)

  const category = backlog.categories.find((candidate) => candidate.id === selection)
  if (!category) return
  const taskIDs = backlog.items.filter((item) => item.status === category.id).map((item) => item.id)
  const count = taskIDs.length
  const action = await context.ui.dialog.select<"rename" | "move" | "purge" | "delete">({
    title: category.title,
    placeholder: "Select an action",
    options: [
      { title: "Rename", value: "rename" },
      { title: "Move", value: "move" },
      ...(count === 0
        ? [{ title: "Delete empty category", value: "delete" as const }]
        : [{ title: `Purge category and ${count} ${count === 1 ? "task" : "tasks"}`, value: "purge" as const }]),
    ],
  })
  if (action === "rename") return renameBacklogCategory(context, category)
  if (action === "move") return moveBacklogCategory(context, category)
  if (action === "delete") return deleteBacklogCategory(context, category)
  if (action !== "purge") return

  const confirmed = await context.ui.dialog.confirm({
    title: `Purge ${category.title}`,
    message: `Permanently delete ${count} ${count === 1 ? "task" : "tasks"} from this category?`,
    label: { confirm: "Purge", cancel: "Cancel" },
  })
  if (!confirmed) return
  await purgeConfirmedCategory(path, category.id, taskIDs)
  context.ui.toast.show({ message: `Purged category "${category.title}".`, variant: "success" })
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
      category: categoryTitle(backlog.categories, item.status),
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
        category: categoryTitle(backlog.categories, item.status),
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
  showTaskDetails(context, item, backlog.categories)
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
        description: "View backlog tasks and change their category",
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
        description: "Create a task at the top of the first category",
        group: "Backlog",
        palette: true,
        slash: { name: "backlog-add", aliases: ["task-add"] },
        run: () => run(() => addBacklogItem(props.context)),
      },
      {
        id: "backlog.move",
        title: "Move backlog task",
        description: "Change a backlog task category",
        group: "Backlog",
        palette: true,
        slash: { name: "backlog-move", aliases: ["task-move"] },
        run: () => run(() => moveBacklogItem(props.context)),
      },
      {
        id: "backlog.purge",
        title: "Purge backlog category",
        description: "Permanently delete every task in a category",
        group: "Backlog",
        palette: true,
        slash: { name: "backlog-purge" },
        run: () => run(() => purgeBacklogCategory(props.context)),
      },
      {
        id: "backlog.categories",
        title: "Manage backlog categories",
        description: "Add, rename, move, purge, or delete a category",
        group: "Backlog",
        palette: true,
        slash: { name: "backlog-categories" },
        run: () => run(() => manageBacklogCategories(props.context)),
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
        bind: "p",
        title: "Purge backlog category",
        group: "Backlog",
        run() {
          setBrowseOpen(false)
          return run(() => purgeBacklogCategory(props.context))
        },
      },
      {
        bind: "c",
        title: "Change selected task category",
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
