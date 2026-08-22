import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"
import { EMPTY_BACKLOG, parseBacklog, type Backlog } from "./backlog.js"

export async function readBacklog(path: string): Promise<Backlog> {
  try {
    return parseBacklog(JSON.parse(await readFile(path, "utf8")))
  } catch (error) {
    if (isMissingFile(error)) return EMPTY_BACKLOG
    throw error
  }
}

export function readBacklogSync(path: string): Backlog {
  try {
    return parseBacklog(JSON.parse(readFileSync(path, "utf8")))
  } catch (error) {
    if (isMissingFile(error)) return EMPTY_BACKLOG
    throw error
  }
}

export async function updateBacklog(
  path: string,
  update: (backlog: Backlog) => Backlog,
): Promise<Backlog> {
  const release = await lockfile.lock(path, {
    realpath: false,
    retries: { retries: 10, minTimeout: 10, maxTimeout: 250 },
    stale: 10_000,
  })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`

  try {
    const result = parseBacklog(update(await readBacklog(path)))
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, "utf8")
    await rename(temporary, path)
    return result
  } finally {
    try {
      await rm(temporary, { force: true })
    } finally {
      await release()
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
