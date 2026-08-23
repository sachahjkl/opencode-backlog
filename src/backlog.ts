export const BACKLOG_FILE = "BACKLOG.json"

export interface Category {
  readonly id: string
  readonly title: string
}

export type Status = string

export interface BacklogItem {
  readonly id: string
  readonly title: string
  readonly notes?: string
  readonly status: Status
}

export interface Backlog {
  readonly version: 2
  readonly categories: readonly Category[]
  readonly items: readonly BacklogItem[]
}

export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: "todo", title: "Todo" },
  { id: "doing", title: "Doing" },
  { id: "done", title: "Done" },
]

export const EMPTY_BACKLOG: Backlog = { version: 2, categories: DEFAULT_CATEGORIES, items: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validateCategory(category: unknown, index?: number): Category {
  const label = index === undefined ? "Category" : `Backlog category ${index}`
  if (!isRecord(category)) throw new Error(`${label} must be an object`)
  if (typeof category.id !== "string" || category.id.trim().length === 0) {
    throw new Error(`${label} must have a non-empty id`)
  }
  if (typeof category.title !== "string" || category.title.trim().length === 0) {
    throw new Error(`${label} must have a non-empty title`)
  }
  return { id: category.id, title: category.title }
}

function validateCategories(value: unknown): Category[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("A version 2 backlog must have at least one category")
  }

  const ids = new Set<string>()
  return value.map((value, index) => {
    const category = validateCategory(value, index)
    if (ids.has(category.id)) throw new Error(`Backlog category id ${category.id} is duplicated`)
    ids.add(category.id)
    return category
  })
}

function validateItems(value: unknown, categories: readonly Category[]): BacklogItem[] {
  if (!Array.isArray(value)) throw new Error("Backlog items must be an array")

  const ids = new Set<string>()
  return value.map((item, index): BacklogItem => {
    if (!isRecord(item)) throw new Error(`Backlog item ${index} must be an object`)
    if (typeof item.id !== "string" || item.id.trim().length === 0) {
      throw new Error(`Backlog item ${index} must have a non-empty id`)
    }
    if (ids.has(item.id)) throw new Error(`Backlog item id ${item.id} is duplicated`)
    if (typeof item.title !== "string" || item.title.trim().length === 0) {
      throw new Error(`Backlog item ${item.id} must have a non-empty title`)
    }
    if (item.notes !== undefined && typeof item.notes !== "string") {
      throw new Error(`Backlog item ${item.id} has invalid notes`)
    }
    if (typeof item.status !== "string" || !categories.some(({ id }) => id === item.status)) {
      throw new Error(`Backlog item ${item.id} has an invalid status`)
    }

    ids.add(item.id)
    return {
      id: item.id,
      title: item.title,
      ...(item.notes === undefined ? {} : { notes: item.notes }),
      status: item.status,
    }
  })
}

export function isStatus(backlog: Backlog, value: unknown): value is Status {
  return typeof value === "string" && backlog.categories.some(({ id }) => id === value)
}

export function parseBacklog(value: unknown): Backlog {
  if (!isRecord(value)) throw new Error("BACKLOG.json must contain a backlog object")

  if (value.version === 1) {
    return {
      version: 2,
      categories: DEFAULT_CATEGORIES,
      items: validateItems(value.items, DEFAULT_CATEGORIES),
    }
  }
  if (value.version !== 2) throw new Error(`Unsupported backlog version ${String(value.version)}`)

  const categories = validateCategories(value.categories)
  return { version: 2, categories, items: validateItems(value.items, categories) }
}

export function sortByStatus(
  items: readonly BacklogItem[],
  categories: readonly Category[],
): BacklogItem[] {
  return categories.flatMap(({ id }) => items.filter((item) => item.status === id))
}

export function moveItem(
  items: readonly BacklogItem[],
  id: string,
  status: Status | undefined,
  position: number | undefined,
  categories: readonly Category[],
): BacklogItem[] {
  const item = items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Backlog item ${id} does not exist`)

  const targetStatus = status ?? item.status
  if (!categories.some((category) => category.id === targetStatus)) {
    throw new Error(`Backlog category ${targetStatus} does not exist`)
  }

  const remaining = items.filter((candidate) => candidate.id !== id)
  const target = remaining.filter((candidate) => candidate.status === targetStatus)
  target.splice(clampPosition(position, target.length), 0, { ...item, status: targetStatus })

  return categories.flatMap(({ id: categoryId }) =>
    categoryId === targetStatus
      ? target
      : remaining.filter((candidate) => candidate.status === categoryId),
  )
}

export function describeBacklog(backlog: Backlog, statuses?: readonly Status[]): string {
  const selected = statuses ?? backlog.categories.map(({ id }) => id)

  return selected.map((status) => {
    const category = backlog.categories.find(({ id }) => id === status)
    if (!category) throw new Error(`Backlog category ${status} does not exist`)

    const items = backlog.items.filter((item) => item.status === status)
    const lines = items.map((item, index) => {
      const notes = item.notes ? `\n   Notes: ${item.notes}` : ""
      return `${index}. ${item.id}: ${item.title}${notes}`
    })
    return `${category.title.toUpperCase()} [${category.id}] (${items.length})\n${lines.length > 0 ? lines.join("\n") : "Empty"}`
  }).join("\n\n")
}

export function addCategory(
  backlog: Backlog,
  category: Category,
  position?: number,
): Backlog {
  const added = validateCategory(category)
  if (backlog.categories.some(({ id }) => id === added.id)) {
    throw new Error(`Backlog category id ${added.id} is duplicated`)
  }

  const categories = [...backlog.categories]
  categories.splice(clampPosition(position, categories.length), 0, added)
  return { ...backlog, categories }
}

export function renameCategory(backlog: Backlog, id: string, title: string): Backlog {
  if (title.trim().length === 0) throw new Error("Category must have a non-empty title")
  if (!backlog.categories.some((category) => category.id === id)) {
    throw new Error(`Backlog category ${id} does not exist`)
  }

  return {
    ...backlog,
    categories: backlog.categories.map((category) =>
      category.id === id ? { ...category, title } : category,
    ),
  }
}

export function moveCategory(backlog: Backlog, id: string, position: number): Backlog {
  const category = backlog.categories.find((candidate) => candidate.id === id)
  if (!category) throw new Error(`Backlog category ${id} does not exist`)

  const categories = backlog.categories.filter((candidate) => candidate.id !== id)
  categories.splice(clampPosition(position, categories.length), 0, category)
  return { ...backlog, categories, items: sortByStatus(backlog.items, categories) }
}

export function removeCategory(backlog: Backlog, id: string): Backlog {
  requireRemovableCategory(backlog, id)
  if (backlog.items.some((item) => item.status === id)) {
    throw new Error(`Backlog category ${id} is not empty`)
  }
  return { ...backlog, categories: backlog.categories.filter((category) => category.id !== id) }
}

export function purgeCategory(backlog: Backlog, id: string): Backlog {
  if (!backlog.categories.some((category) => category.id === id)) {
    throw new Error(`Backlog category ${id} does not exist`)
  }
  return {
    ...backlog,
    items: backlog.items.filter((item) => item.status !== id),
  }
}

function requireRemovableCategory(backlog: Backlog, id: string): void {
  if (!backlog.categories.some((category) => category.id === id)) {
    throw new Error(`Backlog category ${id} does not exist`)
  }
  if (backlog.categories.length === 1) throw new Error("Cannot remove the final backlog category")
}

function clampPosition(position: number | undefined, length: number): number {
  return Math.max(0, Math.min(position ?? length, length))
}
