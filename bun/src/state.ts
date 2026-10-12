import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'

import type { CheckResult } from './check'

const STATE_FILE = 'uptime-state.json'

export interface State {
  checkedAt: string
  targets: Record<string, { ok: boolean, status: number | null }>
}

export interface StatusChange {
  url: string
  from: 'up' | 'down'
  to: 'up' | 'down'
}

// Returns the previous run's state, or null on the first run.
export async function readState(dir: string): Promise<State | null> {
  const file = Bun.file(join(dir, STATE_FILE))
  if (!(await file.exists())) return null
  return await file.json() as State
}

// Writes to a temporary file and renames it, so a run cancelled mid-write
// never leaves a truncated state file behind.
export async function writeState(dir: string, results: CheckResult[], now = new Date()): Promise<void> {
  const state: State = {
    checkedAt: now.toISOString(),
    targets: Object.fromEntries(results.map((result) => [result.url, { ok: result.ok, status: result.status }])),
  }
  await mkdir(dir, { recursive: true })
  const tmpFile = join(dir, `${STATE_FILE}.${process.pid}.tmp`)
  await Bun.write(tmpFile, `${JSON.stringify(state, null, 2)}\n`)
  await rename(tmpFile, join(dir, STATE_FILE))
}

// Lists the targets whose up/down status changed since the previous run.
export function diffState(previous: State | null, results: Pick<CheckResult, 'url' | 'ok'>[]): StatusChange[] {
  if (!previous?.targets) return []

  return results.flatMap((result): StatusChange[] => {
    const before = previous.targets[result.url]
    if (!before || before.ok === result.ok) return []
    return [{ url: result.url, from: before.ok ? 'up' : 'down', to: result.ok ? 'up' : 'down' }]
  })
}
