import { watch, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { BACKLOG_FILE, EMPTY_BACKLOG, STATUSES, type Backlog, type Status } from "./backlog.js"
import { readBacklogSync } from "./store.js"

function statusLabel(status: Status): string {
  if (status === "todo") return "Todo"
  if (status === "doing") return "Doing"
  return "Done"
}

function BacklogView(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const directory = props.context.data.session.get(props.sessionID)?.location.directory
  let backlog: Backlog = EMPTY_BACKLOG
  let error: string | undefined
  try {
    if (directory) backlog = readBacklogSync(join(directory, BACKLOG_FILE))
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

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
      <Show when={error}>
        {(message) => <text fg={theme.text.feedback.error.default}>{message()}</text>}
      </Show>
      <Show when={!error && backlog.items.length === 0}>
        <text fg={theme.text.subdued}>No tasks</text>
      </Show>
      <For each={STATUSES}>
        {(status) => {
          const items = createMemo(() => backlog.items.filter((item) => item.status === status))
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

export default Plugin.define({
  id: "opencode.backlog.tui",
  setup(context) {
    const watchers = new Map<string, FSWatcher>()
    let disposed = false
    let refreshPending = false
    let releaseSlot: () => void = () => {}

    const refresh = () => {
      if (disposed || refreshPending) return
      refreshPending = true
      queueMicrotask(() => {
        refreshPending = false
        if (disposed) return
        releaseSlot()
        releaseSlot = registerSlot()
      })
    }

    const watchDirectory = (directory: string) => {
      if (watchers.has(directory)) return
      const watcher = watch(directory, { persistent: false }, (_event, filename) => {
        if (filename === BACKLOG_FILE) refresh()
      })
      watchers.set(directory, watcher)
    }

    const registerSlot = () =>
      context.ui.slot({
        append: "sidebar.content",
        render: (props) => {
          const directory = context.data.session.get(props.sessionID)?.location.directory
          if (directory) watchDirectory(directory)
          return <BacklogView context={context} sessionID={props.sessionID} />
        },
      })

    releaseSlot = registerSlot()
    return () => {
      disposed = true
      releaseSlot()
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
    }
  },
})
