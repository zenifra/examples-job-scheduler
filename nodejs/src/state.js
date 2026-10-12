import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const STATE_FILE = 'uptime-state.json'

// Returns the previous run's state, or null on the first run.
export async function readState(dir) {
  try {
    return JSON.parse(await readFile(join(dir, STATE_FILE), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

// Writes to a temporary file and renames it, so a run cancelled mid-write
// never leaves a truncated state file behind.
export async function writeState(dir, results, now = new Date()) {
  const state = {
    checkedAt: now.toISOString(),
    targets: Object.fromEntries(results.map((result) => [result.url, { ok: result.ok, status: result.status }])),
  }
  await mkdir(dir, { recursive: true })
  const tmpFile = join(dir, `${STATE_FILE}.${process.pid}.tmp`)
  await writeFile(tmpFile, `${JSON.stringify(state, null, 2)}\n`)
  await rename(tmpFile, join(dir, STATE_FILE))
}

// Lists the targets whose up/down status changed since the previous run.
export function diffState(previous, results) {
  if (!previous?.targets) return []

  return results.flatMap((result) => {
    const before = previous.targets[result.url]
    if (!before || before.ok === result.ok) return []
    return [{ url: result.url, from: before.ok ? 'up' : 'down', to: result.ok ? 'up' : 'down' }]
  })
}
