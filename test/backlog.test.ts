import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DEFAULT_CATEGORIES,
  addCategory,
  describeBacklog,
  isStatus,
  moveCategory,
  moveItem,
  parseBacklog,
  purgeCategory,
  removeCategory,
  renameCategory,
  setCategoryColor,
  setCategoryIcon,
  sortByStatus,
  type Backlog,
  type BacklogItem,
} from "../src/backlog.js"

const categories = [...DEFAULT_CATEGORIES, { id: "blocked", title: "Blocked" }]
const items: BacklogItem[] = [
  { id: "a", title: "First", status: "todo" },
  { id: "b", title: "Second", status: "todo" },
  { id: "c", title: "Active", status: "doing" },
  { id: "d", title: "Waiting", status: "blocked" },
]
const backlog: Backlog = { version: 2, categories, items }

describe("parseBacklog", () => {
  it("normalizes a valid version 1 backlog to version 2", () => {
    const legacyItems = items.slice(0, 3)
    assert.deepEqual(parseBacklog({ version: 1, items: legacyItems }), {
      version: 2,
      categories: DEFAULT_CATEGORIES,
      items: legacyItems,
    })
  })

  it("accepts a valid version 2 backlog", () => {
    assert.deepEqual(parseBacklog(backlog), backlog)
  })

  it("rejects unknown versions", () => {
    assert.throws(() => parseBacklog({ version: 3, categories, items }), /Unsupported backlog version/)
  })

  it("rejects invalid category lists", () => {
    assert.throws(() => parseBacklog({ version: 2, categories: [], items: [] }), /at least one/)
    assert.throws(
      () => parseBacklog({ version: 2, categories: [{ id: "", title: "Empty" }], items: [] }),
      /non-empty id/,
    )
    assert.throws(
      () => parseBacklog({ version: 2, categories: [{ id: "todo", title: " " }], items: [] }),
      /non-empty title/,
    )
    assert.throws(
      () => parseBacklog({ version: 2, categories: [categories[0], categories[0]], items: [] }),
      /duplicated/,
    )
    assert.throws(
      () => parseBacklog({ version: 2, categories: [{ id: "todo", title: "Todo", color: "pink" }], items: [] }),
      /invalid color/,
    )
    assert.throws(
      () => parseBacklog({ version: 2, categories: [{ id: "todo", title: "Todo", icon: "star" }], items: [] }),
      /invalid icon/,
    )
  })

  it("rejects invalid items", () => {
    assert.throws(
      () => parseBacklog({ version: 2, categories, items: [items[0], items[0]] }),
      /duplicated/,
    )
    assert.throws(
      () => parseBacklog({ version: 2, categories, items: [{ ...items[0], id: " " }] }),
      /non-empty id/,
    )
    assert.throws(
      () => parseBacklog({ version: 2, categories, items: [{ ...items[0], title: " " }] }),
      /non-empty title/,
    )
    assert.throws(
      () => parseBacklog({ version: 2, categories: DEFAULT_CATEGORIES, items: [items[3]] }),
      /invalid status/,
    )
  })
})

describe("category order", () => {
  it("checks category IDs against the backlog categories", () => {
    assert.equal(isStatus(backlog, "blocked"), true)
    assert.equal(isStatus(backlog, "missing"), false)
  })

  it("sorts items by category and preserves order inside each category", () => {
    assert.deepEqual(
      sortByStatus([items[3]!, items[1]!, items[2]!, items[0]!], categories).map(({ id }) => id),
      ["b", "a", "c", "d"],
    )
  })
})

describe("moveItem", () => {
  it("reorders a task within its category", () => {
    assert.deepEqual(
      moveItem(items, "b", undefined, 0, categories).map(({ id }) => id),
      ["b", "a", "c", "d"],
    )
  })

  it("moves a task to another category", () => {
    assert.deepEqual(
      moveItem(items, "a", "doing", 1, categories).map((item) => `${item.status}:${item.id}`),
      ["todo:b", "doing:c", "doing:a", "blocked:d"],
    )
  })

  it("clamps positions and rejects unknown categories", () => {
    assert.deepEqual(moveItem(items, "a", "doing", 99, categories).map(({ id }) => id), ["b", "c", "a", "d"])
    assert.throws(() => moveItem(items, "a", "missing", 0, categories), /does not exist/)
  })
})

describe("describeBacklog", () => {
  it("uses category titles and selected category IDs", () => {
    assert.equal(describeBacklog(backlog, ["blocked"]), "BLOCKED [blocked] (1)\n0. d: Waiting")
  })

  it("lists configured categories when all categories are empty", () => {
    assert.equal(
      describeBacklog({ ...backlog, items: [] }),
      "TODO [todo] (0)\nEmpty\n\nDOING [doing] (0)\nEmpty\n\nDONE [done] (0)\nEmpty\n\nBLOCKED [blocked] (0)\nEmpty",
    )
  })

  it("filters tasks by a case-insensitive search term", () => {
    assert.equal(describeBacklog(backlog, undefined, "wait"), "BLOCKED [blocked] (1)\n0. d: Waiting")
    assert.equal(describeBacklog(backlog, ["todo"], "missing"), "No backlog tasks match \"missing\".")
  })
})

describe("category operations", () => {
  it("adds and renames a category", () => {
    const added = addCategory(backlog, { id: "review", title: "Review" }, 1)
    assert.deepEqual(added.categories.map(({ id }) => id), ["todo", "review", "doing", "done", "blocked"])
    assert.equal(renameCategory(added, "review", "Code review").categories[1]?.title, "Code review")
    assert.throws(() => addCategory(backlog, categories[0]!), /duplicated/)
    assert.throws(() => renameCategory(backlog, "todo", " "), /non-empty title/)
  })

  it("sets a category color", () => {
    assert.equal(setCategoryColor(backlog, "blocked", "error").categories[3]?.color, "error")
    assert.throws(() => setCategoryColor(backlog, "missing", "info"), /does not exist/)
  })

  it("sets a category icon", () => {
    assert.equal(setCategoryIcon(backlog, "blocked", "cross").categories[3]?.icon, "cross")
    assert.throws(() => setCategoryIcon(backlog, "missing", "circle"), /does not exist/)
  })

  it("moves a category and its task group", () => {
    const moved = moveCategory(backlog, "blocked", 0)
    assert.deepEqual(moved.categories.map(({ id }) => id), ["blocked", "todo", "doing", "done"])
    assert.deepEqual(moved.items.map(({ id }) => id), ["d", "a", "b", "c"])
  })

  it("removes only empty non-final categories", () => {
    assert.deepEqual(removeCategory(backlog, "done").categories.map(({ id }) => id), ["todo", "doing", "blocked"])
    assert.throws(() => removeCategory(backlog, "todo"), /not empty/)
    assert.throws(
      () => removeCategory({ version: 2, categories: [categories[0]!], items: [] }, "todo"),
      /final/,
    )
  })

  it("purges a category and all its tasks", () => {
    const purged = purgeCategory(backlog, "todo")
    assert.deepEqual(purged.categories.map(({ id }) => id), ["todo", "doing", "done", "blocked"])
    assert.deepEqual(purged.items.map(({ id }) => id), ["c", "d"])
    assert.deepEqual(
      purgeCategory({ version: 2, categories: [categories[0]!], items: [items[0]!] }, "todo"),
      { version: 2, categories: [categories[0]!], items: [] },
    )
    assert.throws(() => purgeCategory(backlog, "missing"), /does not exist/)
  })
})
