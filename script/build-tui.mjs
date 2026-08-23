import { readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const opentui = import.meta.resolve("@opentui/solid")
const transform = new URL("./scripts/solid-transform.js", opentui)
const { transformSolidSource } = await import(transform)
const source = resolve(root, "src/tui.tsx")
const output = resolve(root, "dist/tui.js")
const code = await readFile(source, "utf8")

await writeFile(output, await transformSolidSource(code, { filename: source }))
await rm(`${output}.map`, { force: true })
