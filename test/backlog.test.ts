import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { moveItem, parseBacklog, type BacklogItem } from "../src/backlog.js"

const items: BacklogItem[] = [
  { id: "a", title: "First", status: "todo" },
  { id: "b", title: "Second", status: "todo" },
  { id: "c", title: "Active", status: "doing" },
]

describe("parseBacklog", () => {
  it("accepts a valid version 1 backlog", () => {
    assert.deepEqual(parseBacklog({ version: 1, items }), { version: 1, items })
  })

  it("rejects duplicate IDs", () => {
    assert.throws(
      () => parseBacklog({ version: 1, items: [items[0], items[0]] }),
      /duplicated/,
    )
  })
})

describe("moveItem", () => {
  it("reorders a task within its state", () => {
    assert.deepEqual(
      moveItem(items, "b", undefined, 0).map((item) => item.id),
      ["b", "a", "c"],
    )
  })

  it("moves a task to another state", () => {
    assert.deepEqual(
      moveItem(items, "a", "doing", 1).map((item) => `${item.status}:${item.id}`),
      ["todo:b", "doing:c", "doing:a"],
    )
  })

  it("clamps positions past the end", () => {
    assert.deepEqual(
      moveItem(items, "a", "doing", 99).map((item) => item.id),
      ["b", "c", "a"],
    )
  })
})
