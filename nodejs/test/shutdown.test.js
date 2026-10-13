import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { after, before, mock, test } from 'node:test'

import { createLogger } from '../src/main.js'
import { FORCED_EXIT_AFTER_MS, listenForStopSignals } from '../src/shutdown.js'
import { memoryLogger, startServer } from './helpers.js'

let server
before(async () => { server = await startServer() })
after(() => server.close())

// Starts the real entry point, as Zenifra does, and waits until the job reports it started.
async function startJob(env) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/index.js', import.meta.url))], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const lines = []
  child.stdout.setEncoding('utf8').on('data', (chunk) => lines.push(...chunk.trim().split('\n').map((line) => JSON.parse(line))))
  const deadline = Date.now() + 10_000
  while (!lines.some((line) => line.msg === 'job started')) {
    assert.ok(Date.now() < deadline, 'job did not start')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return { child, lines }
}

for (const [signal, expectedCode] of [['SIGTERM', 143], ['SIGINT', 130]]) {
  test(`${signal} stops the job gracefully and exits with ${expectedCode}`, async () => {
    const { child, lines } = await startJob({ TARGET_URLS: `${server.base}/slow`, MAX_ATTEMPTS: '1' })
    const startedAt = Date.now()

    child.kill(signal)
    const [code] = await once(child, 'exit')

    assert.equal(code, expectedCode)
    assert.ok(Date.now() - startedAt < 2_000, 'stops well before the 30-second limit')
    assert.deepEqual(lines.map((line) => line.msg), ['job started', 'stop signal received', 'job cancelled before finishing'])
    assert.equal(lines[1].signal, signal)
  })
}

test('work that ignores the abort is cut off before the 30-second limit', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const exits = []
    const output = memoryLogger()
    const stop = listenForStopSignals(createLogger(output), { exit: (code) => exits.push(code) })

    process.emit('SIGTERM')
    assert.equal(stop.signal.aborted, true)
    assert.equal(stop.exitCode(), 143)

    mock.timers.tick(FORCED_EXIT_AFTER_MS - 1)
    assert.deepEqual(exits, [])
    mock.timers.tick(1)
    assert.deepEqual(exits, [143])
    assert.ok(FORCED_EXIT_AFTER_MS < 30_000)
  } finally {
    mock.timers.reset()
    process.removeAllListeners('SIGINT')
  }
})
