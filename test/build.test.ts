import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

test("TUI build uses the Solid transform", async () => {
  const output = await readFile(join(process.cwd(), "dist/tui.js"), "utf8")

  assert.match(output, /get each\(\)/)
  assert.match(output, /get when\(\)/)
  assert.doesNotMatch(output, /@opentui\/solid\/jsx-runtime/)
})
