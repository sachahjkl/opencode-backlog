import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { Plugin } from "@opencode-ai/plugin"
import {
  BACKLOG_FILE,
  addCategory,
  describeBacklog,
  moveItem,
  moveCategory,
  purgeCategory,
  removeCategory,
  renameCategory,
  sortByStatus,
  type Backlog,
  type BacklogItem,
} from "./backlog.js"
import {
  optionalNullableString,
  optionalPosition,
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
  },
  required: ["id", "title"],
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

export default Plugin.define({
  id: "opencode.backlog",
  tui: true,
  async setup(context) {
    await context.tool.transform((tools) => {
      tools.add({
        name: "backlog_list",
        description: "List the ordered project backlog, optionally filtered by category ID.",
        input: {
          type: "object",
          properties: { status: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const backlog = await readForSession(context, toolContext.sessionID)
          const status = optionalStatus(record(input), backlog)
          return {
            content: describeBacklog(backlog, status === undefined ? undefined : [status]),
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
          return { content: `Added ${item.id}.\n\n${describeBacklog(backlog)}` }
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
          const backlog = await updateForSession(context, toolContext.sessionID, (current) => {
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
          return { content: `Updated ${id}.\n\n${describeBacklog(backlog)}` }
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
          return { content: `Moved ${id}.\n\n${describeBacklog(backlog)}` }
        },
      })

      tools.add({
        name: "backlog_remove",
        description: "Permanently remove a task from the project backlog.",
        input: idInput,
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const id = requiredString(record(input), "id")
          const backlog = await updateForSession(context, toolContext.sessionID, (current) => {
            if (!current.items.some((item) => item.id === id)) {
              throw new Error(`Backlog item ${id} does not exist`)
            }
            return {
              version: 2,
              categories: current.categories,
              items: current.items.filter((item) => item.id !== id),
            }
          })
          return { content: `Removed ${id}.\n\n${describeBacklog(backlog)}` }
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
          const position = optionalPosition(values)
          const backlog = await updateForSession(context, toolContext.sessionID, (current) =>
            addCategory(current, { id, title }, position),
          )
          return { content: `Added category ${id}.\n\n${describeBacklog(backlog)}` }
        },
      })

      tools.add({
        name: "backlog_category_update",
        description: "Change a backlog category title.",
        input: categoryTitleInput,
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const values = record(input)
          const id = requiredString(values, "id")
          const title = requiredString(values, "title")
          const backlog = await updateForSession(context, toolContext.sessionID, (current) =>
            renameCategory(current, id, title),
          )
          return { content: `Updated category ${id}.\n\n${describeBacklog(backlog)}` }
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
          return { content: `Moved category ${id}.\n\n${describeBacklog(backlog)}` }
        },
      })

      tools.add({
        name: "backlog_category_remove",
        description: "Remove an empty backlog category.",
        input: idInput,
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const id = requiredString(record(input), "id")
          const backlog = await updateForSession(context, toolContext.sessionID, (current) =>
            removeCategory(current, id),
          )
          return { content: `Removed category ${id}.\n\n${describeBacklog(backlog)}` }
        },
      })

      tools.add({
        name: "backlog_category_purge",
        description: "Permanently remove all tasks in a backlog category while retaining the category.",
        input: idInput,
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const id = requiredString(record(input), "id")
          const backlog = await updateForSession(context, toolContext.sessionID, (current) =>
            purgeCategory(current, id),
          )
          return { content: `Purged tasks from category ${id}.\n\n${describeBacklog(backlog)}` }
        },
      })
    })
  },
})
