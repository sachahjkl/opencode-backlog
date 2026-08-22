import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { readBacklog, updateBacklog } from "../src/store.js"

const directories: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("backlog store", () => {
  it("returns an empty backlog when the file does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-backlog-"))
    directories.push(directory)
    assert.deepEqual(await readBacklog(join(directory, "BACKLOG.json")), { version: 1, items: [] })
  })

  it("writes valid formatted JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-backlog-"))
    directories.push(directory)
    const path = join(directory, "BACKLOG.json")

    await updateBacklog(path, () => ({
      version: 1,
      items: [{ id: "task", title: "Test the store", status: "todo" }],
    }))

    assert.deepEqual(await readBacklog(path), {
      version: 1,
      items: [{ id: "task", title: "Test the store", status: "todo" }],
    })
    assert.match(await readFile(path, "utf8"), /  "version": 1/)
  })

  it("serializes concurrent updates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-backlog-"))
    directories.push(directory)
    const path = join(directory, "BACKLOG.json")

    await Promise.all(
      ["one", "two", "three"].map((id) =>
        updateBacklog(path, (backlog) => ({
          version: 1,
          items: [...backlog.items, { id, title: id, status: "todo" }],
        })),
      ),
    )

    assert.deepEqual(
      (await readBacklog(path)).items.map((item) => item.id).sort(),
      ["one", "three", "two"],
    )
  })

  it("serializes updates from separate processes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-backlog-"))
    directories.push(directory)
    const path = join(directory, "BACKLOG.json")
    const storeUrl = pathToFileURL(join(process.cwd(), "dist/store.js")).href
    const script = `
      import { updateBacklog } from ${JSON.stringify(storeUrl)}
      const [path, id] = process.argv.slice(1)
      await updateBacklog(path, (backlog) => ({
        version: 1,
        items: [...backlog.items, { id, title: id, status: "todo" }],
      }))
    `

    await Promise.all(
      ["one", "two", "three", "four", "five"].map((id) =>
        execFileAsync(process.execPath, ["--input-type=module", "--eval", script, path, id]),
      ),
    )

    assert.deepEqual(
      [...(await readBacklog(path)).items.map((item) => item.id)].sort(),
      ["five", "four", "one", "three", "two"],
    )
  })
})
