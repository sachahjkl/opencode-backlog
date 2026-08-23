import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { readBacklog, readBacklogSync, updateBacklog } from "../src/store.js"

const directories: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("backlog store", () => {
  it("returns an empty backlog when the file does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-backlog-"))
    directories.push(directory)
    const path = join(directory, "BACKLOG.json")
    const empty = {
      version: 2,
      categories: [
        { id: "todo", title: "Todo" },
        { id: "doing", title: "Doing" },
        { id: "done", title: "Done" },
      ],
      items: [],
    }
    assert.deepEqual(await readBacklog(path), empty)
    assert.deepEqual(readBacklogSync(path), empty)
  })

  it("writes valid formatted JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-backlog-"))
    directories.push(directory)
    const path = join(directory, "BACKLOG.json")

    await updateBacklog(path, () => ({
      version: 2,
      categories: [
        { id: "todo", title: "Todo" },
        { id: "doing", title: "Doing" },
        { id: "done", title: "Done" },
      ],
      items: [{ id: "task", title: "Test the store", status: "todo" }],
    }))

    assert.deepEqual(await readBacklog(path), {
      version: 2,
      categories: [
        { id: "todo", title: "Todo" },
        { id: "doing", title: "Doing" },
        { id: "done", title: "Done" },
      ],
      items: [{ id: "task", title: "Test the store", status: "todo" }],
    })
    assert.match(await readFile(path, "utf8"), /  "version": 2/)
  })

  it("writes a version 1 backlog as version 2 on its next update", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-backlog-"))
    directories.push(directory)
    const path = join(directory, "BACKLOG.json")
    await writeFile(path, JSON.stringify({
      version: 1,
      items: [{ id: "legacy", title: "Migrate", status: "todo" }],
    }))

    assert.equal((await readBacklog(path)).version, 2)
    assert.equal(readBacklogSync(path).version, 2)
    assert.equal(JSON.parse(await readFile(path, "utf8")).version, 1)

    await updateBacklog(path, (current) => current)

    const stored = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
    assert.equal(stored.version, 2)
    assert.deepEqual(stored.categories, [
      { id: "todo", title: "Todo" },
      { id: "doing", title: "Doing" },
      { id: "done", title: "Done" },
    ])
  })

  it("serializes concurrent updates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-backlog-"))
    directories.push(directory)
    const path = join(directory, "BACKLOG.json")

    await Promise.all(
      ["one", "two", "three"].map((id) =>
        updateBacklog(path, (backlog) => ({
          ...backlog,
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
        ...backlog,
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
