import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { Plugin } from "@opencode-ai/plugin"
import {
  BACKLOG_FILE,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  addCategory,
  describeBacklog,
  moveItem,
  moveCategory,
  purgeCategory,
  removeCategory,
  renameCategory,
  setCategoryColor,
  setCategoryIcon,
  sortByStatus,
  type Backlog,
  type BacklogItem,
} from "./backlog.js"
import {
  optionalNullableString,
  optionalCategoryColor,
  optionalCategoryIcon,
  optionalPosition,
  optionalString,
  optionalStatus,
  record,
  requiredString,
} from "./input.js"
import { readBacklog, updateBacklog } from "./store.js"

const idInput = {
  type: "object",
  properties: { id: { type: "string", minLength: 1 } },
  required: ["id"],
  additionalProperties: false,
} as const

const categoryTitleInput = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    color: { type: "string", enum: CATEGORY_COLORS },
    icon: { type: "string", enum: CATEGORY_ICONS },
  },
  required: ["id"],
  additionalProperties: false,
} as const

async function backlogPath(context: Plugin.Context, sessionID: string): Promise<string> {
  const session = await context.session.get({ sessionID })
  return join(session.location.directory, BACKLOG_FILE)
}

async function readForSession(context: Plugin.Context, sessionID: string): Promise<Backlog> {
  return readBacklog(await backlogPath(context, sessionID))
}

async function updateForSession(
  context: Plugin.Context,
  sessionID: string,
  update: (backlog: Backlog) => Backlog,
): Promise<Backlog> {
  return updateBacklog(await backlogPath(context, sessionID), update)
}

function replaceItem(items: readonly BacklogItem[], replacement: BacklogItem): BacklogItem[] {
  if (!items.some((item) => item.id === replacement.id)) {
    throw new Error(`Backlog item ${replacement.id} does not exist`)
  }
  return items.map((item) => (item.id === replacement.id ? replacement : item))
}

function itemLocation(backlog: Backlog, id: string): { item: BacklogItem; position: number } {
  const item = backlog.items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Backlog item ${id} does not exist`)
  const position = backlog.items
    .filter((candidate) => candidate.status === item.status)
    .findIndex((candidate) => candidate.id === id)
  return { item, position }
}

export default Plugin.define({
  id: "opencode.backlog",
  tui: true,
  async setup(context) {
    await context.tool.transform((tools) => {
      tools.add({
        name: "backlog_list",
        description: "List the ordered project backlog, optionally filtered by category ID and search term.",
        input: {
          type: "object",
          properties: {
            category: { type: "string", minLength: 1 },
            query: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const backlog = await readForSession(context, toolContext.sessionID)
          const values = record(input)
          const category = optionalStatus(values, backlog, "category")
          const query = optionalString(values, "query")
          return {
            content: describeBacklog(backlog, category === undefined ? undefined : [category], query),
          }
        },
      })

      tools.add({
        name: "backlog_add",
        description: "Add a task at a zero-based position within a backlog category.",
        input: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1 },
            notes: { type: "string" },
            status: { type: "string", minLength: 1 },
            position: { type: "integer", minimum: 0 },
          },
          required: ["title"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const values = record(input)
          const title = requiredString(values, "title")
          const notes = optionalNullableString(values, "notes") ?? undefined
          const position = optionalPosition(values)
          let item: BacklogItem | undefined
          const backlog = await updateForSession(context, toolContext.sessionID, (current) => {
            const firstCategory = current.categories[0]
            if (!firstCategory) throw new Error("The backlog must have at least one category")
            const status = optionalStatus(values, current) ?? firstCategory.id
            item = {
              id: randomUUID(),
              title,
              ...(notes === undefined ? {} : { notes }),
              status,
            }
            return {
              version: 2,
              categories: current.categories,
              items: moveItem([...current.items, item], item.id, status, position, current.categories),
            }
          })
          if (!item) throw new Error("Backlog update did not add an item")
          const location = itemLocation(backlog, item.id)
          return { content: `Added ${item.id} to ${location.item.status} at position ${location.position}.` }
        },
      })

      tools.add({
        name: "backlog_update",
        description: "Change a backlog task title or notes. Use null notes to remove them.",
        input: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 },
            notes: { type: ["string", "null"] },
          },
          required: ["id"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const values = record(input)
          const id = requiredString(values, "id")
          const title = values.title === undefined ? undefined : requiredString(values, "title")
          const notes = optionalNullableString(values, "notes")
          if (title === undefined && notes === undefined) {
            throw new Error("backlog_update requires a title or notes change")
          }
          await updateForSession(context, toolContext.sessionID, (current) => {
            const item = current.items.find((candidate) => candidate.id === id)
            if (!item) throw new Error(`Backlog item ${id} does not exist`)
            const { notes: _currentNotes, ...itemWithoutNotes } = item
            const replacement: BacklogItem = {
              ...(notes === null ? itemWithoutNotes : item),
              ...(title === undefined ? {} : { title }),
              ...(notes === undefined || notes === null ? {} : { notes }),
            }
            return {
              version: 2,
              categories: current.categories,
              items: sortByStatus(replaceItem(current.items, replacement), current.categories),
            }
          })
          return { content: `Updated ${id}.` }
        },
      })

      tools.add({
        name: "backlog_move",
        description: "Change a task category or its zero-based position within that category.",
        input: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            status: { type: "string", minLength: 1 },
            position: { type: "integer", minimum: 0 },
          },
          required: ["id"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const values = record(input)
          const id = requiredString(values, "id")
          const position = optionalPosition(values)
          const backlog = await updateForSession(context, toolContext.sessionID, (current) => {
            const status = optionalStatus(values, current)
            if (status === undefined && position === undefined) {
              throw new Error("backlog_move requires a status or position change")
            }
            return {
              version: 2,
              categories: current.categories,
              items: moveItem(current.items, id, status, position, current.categories),
            }
          })
          const location = itemLocation(backlog, id)
          return { content: `Moved ${id} to ${location.item.status} at position ${location.position}.` }
        },
      })

      tools.add({
        name: "backlog_remove",
        description: "Permanently remove a task from the project backlog.",
        input: idInput,
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const id = requiredString(record(input), "id")
          await updateForSession(context, toolContext.sessionID, (current) => {
            if (!current.items.some((item) => item.id === id)) {
              throw new Error(`Backlog item ${id} does not exist`)
            }
            return {
              version: 2,
              categories: current.categories,
              items: current.items.filter((item) => item.id !== id),
            }
          })
          return { content: `Removed ${id}.` }
        },
      })

      tools.add({
        name: "backlog_category_add",
        description: "Add a backlog category with a unique ID, title, and optional zero-based position.",
        input: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 },
            color: { type: "string", enum: CATEGORY_COLORS },
            icon: { type: "string", enum: CATEGORY_ICONS },
            position: { type: "integer", minimum: 0 },
          },
          required: ["id", "title"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const values = record(input)
          const id = requiredString(values, "id")
          const title = requiredString(values, "title")
          const color = optionalCategoryColor(values)
          const icon = optionalCategoryIcon(values)
          const position = optionalPosition(values)
          const backlog = await updateForSession(context, toolContext.sessionID, (current) =>
            addCategory(current, {
              id,
              title,
              ...(color === undefined ? {} : { color }),
              ...(icon === undefined ? {} : { icon }),
            }, position),
          )
          const categoryPosition = backlog.categories.findIndex((category) => category.id === id)
          return { content: `Added category ${id} at position ${categoryPosition}.` }
        },
      })

      tools.add({
        name: "backlog_category_update",
        description: "Change a backlog category title, color, or icon.",
        input: categoryTitleInput,
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const values = record(input)
          const id = requiredString(values, "id")
          const title = values.title === undefined ? undefined : requiredString(values, "title")
          const color = optionalCategoryColor(values)
          const icon = optionalCategoryIcon(values)
          if (title === undefined && color === undefined && icon === undefined) {
            throw new Error("backlog_category_update requires a title, color, or icon change")
          }
          await updateForSession(context, toolContext.sessionID, (current) => {
            const renamed = title === undefined ? current : renameCategory(current, id, title)
            const colored = color === undefined ? renamed : setCategoryColor(renamed, id, color)
            return icon === undefined ? colored : setCategoryIcon(colored, id, icon)
          })
          return { content: `Updated category ${id}.` }
        },
      })

      tools.add({
        name: "backlog_category_move",
        description: "Move a backlog category to a zero-based position.",
        input: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            position: { type: "integer", minimum: 0 },
          },
          required: ["id", "position"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const values = record(input)
          const id = requiredString(values, "id")
          const position = optionalPosition(values)
          if (position === undefined) throw new Error("position is required")
          const backlog = await updateForSession(context, toolContext.sessionID, (current) =>
            moveCategory(current, id, position),
          )
          const categoryPosition = backlog.categories.findIndex((category) => category.id === id)
          return { content: `Moved category ${id} to position ${categoryPosition}.` }
        },
      })

      tools.add({
        name: "backlog_category_remove",
        description: "Remove an empty backlog category.",
        input: idInput,
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const id = requiredString(record(input), "id")
          await updateForSession(context, toolContext.sessionID, (current) =>
            removeCategory(current, id),
          )
          return { content: `Removed category ${id}.` }
        },
      })

      tools.add({
        name: "backlog_category_purge",
        description: "Permanently remove all tasks in a backlog category while retaining the category.",
        input: idInput,
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const id = requiredString(record(input), "id")
          let count = 0
          await updateForSession(context, toolContext.sessionID, (current) => {
            count = current.items.filter((item) => item.status === id).length
            return purgeCategory(current, id)
          })
          return { content: `Purged ${count} ${count === 1 ? "task" : "tasks"} from category ${id}.` }
        },
      })
    })
  },
})
