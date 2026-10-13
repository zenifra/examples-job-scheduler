import { afterAll, expect, test } from 'bun:test'

import { createLogger } from '../src/main'
import { FORCED_EXIT_AFTER_MS, listenForStopSignals } from '../src/shutdown'
import { memoryLogger, startServer } from './helpers'

const server = startServer()
afterAll(() => server.close())

// Starts the real entry point, as Zenifra does, and waits until the job reports it started.
async function startJob(env: Record<string, string>) {
  const child = Bun.spawn(['bun', 'run', `${import.meta.dir}/../src/index.ts`], {
    env: { ...Bun.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const lines: Record<string, any>[] = []
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  const deadline = Date.now() + 10_000
  while (!lines.some((line) => line.msg === 'job started')) {
    expect(Date.now()).toBeLessThan(deadline)
    const { value, done } = await reader.read()
    if (done) break
    lines.push(...decoder.decode(value).trim().split('\n').map((line) => JSON.parse(line)))
  }
  const rest = (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      lines.push(...decoder.decode(value).trim().split('\n').map((line) => JSON.parse(line)))
    }
  })()
  return { child, lines, rest }
}

for (const [signal, expectedCode] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
  test(`${signal} stops the job gracefully and exits with ${expectedCode}`, async () => {
    const { child, lines, rest } = await startJob({ TARGET_URLS: `${server.base}/slow`, MAX_ATTEMPTS: '1' })
    const startedAt = Date.now()

    child.kill(signal)
    const code = await child.exited
    await rest

    expect(code).toBe(expectedCode)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(lines.map((line) => line.msg)).toEqual(['job started', 'stop signal received', 'job cancelled before finishing'])
    expect(lines[1]!.signal).toBe(signal)
  })
}

test('work that ignores the abort is cut off before the 30-second limit', async () => {
  const exits: number[] = []
  const stop = listenForStopSignals(createLogger(memoryLogger()), { exit: (code) => exits.push(code), forcedExitAfterMs: 50 })

  process.emit('SIGTERM')
  expect(stop.signal.aborted).toBe(true)
  expect(stop.exitCode()).toBe(143)
  expect(exits).toEqual([])

  await Bun.sleep(150)
  expect(exits).toEqual([143])
  expect(FORCED_EXIT_AFTER_MS).toBeLessThan(30_000)
  process.removeAllListeners('SIGINT')
})
