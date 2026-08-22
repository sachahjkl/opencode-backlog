export const BACKLOG_FILE = "BACKLOG.json"
export const STATUSES = ["todo", "doing", "done"] as const

export type Status = (typeof STATUSES)[number]

export interface BacklogItem {
  readonly id: string
  readonly title: string
  readonly notes?: string
  readonly status: Status
}

export interface Backlog {
  readonly version: 1
  readonly items: readonly BacklogItem[]
}

export const EMPTY_BACKLOG: Backlog = { version: 1, items: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && STATUSES.includes(value as Status)
}

export function parseBacklog(value: unknown): Backlog {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) {
    throw new Error("BACKLOG.json must contain a version 1 backlog")
  }

  const ids = new Set<string>()
  const items = value.items.map((item, index): BacklogItem => {
    if (!isRecord(item)) throw new Error(`Backlog item ${index} must be an object`)
    if (typeof item.id !== "string" || item.id.length === 0) {
      throw new Error(`Backlog item ${index} must have a non-empty id`)
    }
    if (ids.has(item.id)) throw new Error(`Backlog item id ${item.id} is duplicated`)
    if (typeof item.title !== "string" || item.title.trim().length === 0) {
      throw new Error(`Backlog item ${item.id} must have a non-empty title`)
    }
    if (item.notes !== undefined && typeof item.notes !== "string") {
      throw new Error(`Backlog item ${item.id} has invalid notes`)
    }
    if (!isStatus(item.status)) throw new Error(`Backlog item ${item.id} has an invalid status`)

    ids.add(item.id)
    return {
      id: item.id,
      title: item.title,
      ...(item.notes === undefined ? {} : { notes: item.notes }),
      status: item.status,
    }
  })

  return { version: 1, items }
}

export function sortByStatus(items: readonly BacklogItem[]): BacklogItem[] {
  return STATUSES.flatMap((status) => items.filter((item) => item.status === status))
}

export function moveItem(
  items: readonly BacklogItem[],
  id: string,
  status: Status | undefined,
  position: number | undefined,
): BacklogItem[] {
  const item = items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Backlog item ${id} does not exist`)

  const targetStatus = status ?? item.status
  const remaining = items.filter((candidate) => candidate.id !== id)
  const target = remaining.filter((candidate) => candidate.status === targetStatus)
  const targetPosition = Math.min(position ?? target.length, target.length)
  target.splice(targetPosition, 0, { ...item, status: targetStatus })

  return STATUSES.flatMap((candidateStatus) =>
    candidateStatus === targetStatus
      ? target
      : remaining.filter((candidate) => candidate.status === candidateStatus),
  )
}

export function describeBacklog(backlog: Backlog, statuses: readonly Status[] = STATUSES): string {
  if (backlog.items.length === 0 && statuses.length === STATUSES.length) {
    return "The project backlog is empty."
  }

  return statuses.map((status) => {
    const items = backlog.items.filter((item) => item.status === status)
    const lines = items.map((item, index) => {
      const notes = item.notes ? `\n   Notes: ${item.notes}` : ""
      return `${index}. ${item.id}: ${item.title}${notes}`
    })
    return `${status.toUpperCase()} (${items.length})\n${lines.length > 0 ? lines.join("\n") : "Empty"}`
  }).join("\n\n")
}
