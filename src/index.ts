import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { Plugin } from "@opencode-ai/plugin"
import {
  BACKLOG_FILE,
  describeBacklog,
  moveItem,
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

const noInput = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const

const idInput = {
  type: "object",
  properties: { id: { type: "string", minLength: 1 } },
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

export default Plugin.define({
  id: "opencode.backlog",
  tui: true,
  async setup(context) {
    await context.tool.transform((tools) => {
      tools.add({
        name: "backlog_list",
        description: "List the ordered project backlog, including task IDs, notes, and Kanban states.",
        input: noInput,
        options: { codemode: false },
        execute: async (_input, toolContext) => ({
          content: describeBacklog(await readForSession(context, toolContext.sessionID)),
        }),
      })

      tools.add({
        name: "backlog_add",
        description: "Add a task to the project backlog at a position within a Kanban state.",
        input: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1 },
            notes: { type: "string" },
            status: { type: "string", enum: ["todo", "doing", "done"] },
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
          const status = optionalStatus(values) ?? "todo"
          const position = optionalPosition(values)
          const item: BacklogItem = {
            id: randomUUID(),
            title,
            ...(notes === undefined ? {} : { notes }),
            status,
          }
          const backlog = await updateForSession(context, toolContext.sessionID, (current) => ({
            version: 1,
            items: moveItem([...current.items, item], item.id, status, position),
          }))
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
          anyOf: [{ required: ["title"] }, { required: ["notes"] }],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const values = record(input)
          const id = requiredString(values, "id")
          const title = values.title === undefined ? undefined : requiredString(values, "title")
          const notes = optionalNullableString(values, "notes")
          const backlog = await updateForSession(context, toolContext.sessionID, (current) => {
            const item = current.items.find((candidate) => candidate.id === id)
            if (!item) throw new Error(`Backlog item ${id} does not exist`)
            const { notes: _currentNotes, ...itemWithoutNotes } = item
            const replacement: BacklogItem = {
              ...(notes === null ? itemWithoutNotes : item),
              ...(title === undefined ? {} : { title }),
              ...(notes === undefined || notes === null ? {} : { notes }),
            }
            return { version: 1, items: sortByStatus(replaceItem(current.items, replacement)) }
          })
          return { content: `Updated ${id}.\n\n${describeBacklog(backlog)}` }
        },
      })

      tools.add({
        name: "backlog_move",
        description: "Change a task Kanban state or its zero-based position within that state.",
        input: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["todo", "doing", "done"] },
            position: { type: "integer", minimum: 0 },
          },
          required: ["id"],
          anyOf: [{ required: ["status"] }, { required: ["position"] }],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, toolContext) => {
          const values = record(input)
          const id = requiredString(values, "id")
          const status = optionalStatus(values)
          const position = optionalPosition(values)
          const backlog = await updateForSession(context, toolContext.sessionID, (current) => ({
            version: 1,
            items: moveItem(current.items, id, status, position),
          }))
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
            return { version: 1, items: current.items.filter((item) => item.id !== id) }
          })
          return { content: `Removed ${id}.\n\n${describeBacklog(backlog)}` }
        },
      })
    })
  },
})
