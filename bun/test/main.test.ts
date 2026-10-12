import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLogger, EXIT, run } from '../src/main'
import { diffState } from '../src/state'
import { memoryLogger, startServer } from './helpers'

const server = startServer()
let stateDir: string

afterAll(() => server.close())
beforeEach(async () => {
  server.requests.length = 0
  stateDir = await mkdtemp(join(tmpdir(), 'uptime-job-'))
})
afterEach(() => rm(stateDir, { recursive: true, force: true }))

async function runJob(env: Record<string, string>, extra: { signal?: AbortSignal, deadlineMs?: number } = {}) {
  const output = memoryLogger()
  const code = await run({ env: { MAX_ATTEMPTS: '1', ...env }, log: createLogger(output), ...extra })
  return { code, lines: output.lines }
}

test('exits 0 when every target is up', async () => {
  const { code, lines } = await runJob({ TARGET_URLS: `${server.base}/ok` })

  expect(code).toBe(EXIT.SUCCESS)
  expect(lines.at(-1)).toMatchObject({ msg: 'job finished', down: 0 })
})

test('exits 1 when a target is down, unless FAIL_ON_DOWN=false', async () => {
  const env = { TARGET_URLS: `${server.base}/ok,${server.base}/missing` }

  expect((await runJob(env)).code).toBe(EXIT.FAILURE)
  expect((await runJob({ ...env, FAIL_ON_DOWN: 'false' })).code).toBe(EXIT.SUCCESS)
})

test('exits 2 on invalid configuration', async () => {
  const { code, lines } = await runJob({ TARGET_URLS: '' })

  expect(code).toBe(EXIT.CONFIG)
  expect(lines[0]).toMatchObject({ level: 'error' })
  expect(lines[0]!.reason).toMatch(/TARGET_URLS is required/)
})

test('keeps state between runs and reports status changes to the webhook', async () => {
  const env = { STATE_DIR: stateDir, WEBHOOK_URL: `${server.base}/hook`, FAIL_ON_DOWN: 'false' }

  await runJob({ ...env, TARGET_URLS: `${server.base}/ok` })
  expect(server.requests.filter((request) => request.path === '/hook')).toHaveLength(0)

  const state = await Bun.file(join(stateDir, 'uptime-state.json')).json()
  expect(state.targets[`${server.base}/ok`].ok).toBe(true)

  const { lines } = await runJob({ ...env, TARGET_URLS: `${server.base}/ok,${server.base}/missing` })
  const hook = server.requests.find((request) => request.path === '/hook')
  expect(hook).toBeDefined()
  expect(JSON.parse(hook!.body).text).toMatch(/DOWN .*\/missing/)
  expect(lines.some((line) => line.msg === 'notification sent')).toBe(true)
  expect(JSON.stringify(lines)).not.toContain('/hook')
})

test('diffState reports up/down transitions only', () => {
  const previous = { checkedAt: '', targets: { a: { ok: true, status: 200 }, b: { ok: false, status: 503 }, c: { ok: true, status: 200 } } }
  const results = [{ url: 'a', ok: false }, { url: 'b', ok: true }, { url: 'c', ok: true }, { url: 'd', ok: false }]

  expect(diffState(previous, results)).toEqual([
    { url: 'a', from: 'up', to: 'down' },
    { url: 'b', from: 'down', to: 'up' },
  ])
  expect(diffState(null, results)).toEqual([])
})

test('a failing webhook fails the run', async () => {
  const { code, lines } = await runJob({ TARGET_URLS: `${server.base}/missing`, WEBHOOK_URL: `${server.base}/hook-fail`, FAIL_ON_DOWN: 'false' })

  expect(code).toBe(EXIT.FAILURE)
  expect(lines.find((line) => line.msg === 'notification failed')!.reason).toBe('webhook answered HTTP 500')
})

test('an unusable state directory is logged and does not fail the run', async () => {
  // A path below a regular file can never be created as a directory.
  const file = join(stateDir, 'not-a-directory')
  await Bun.write(file, '')
  const { code, lines } = await runJob({ TARGET_URLS: `${server.base}/ok`, STATE_DIR: join(file, 'state') })

  expect(code).toBe(EXIT.SUCCESS)
  expect(lines.some((line) => line.msg === 'could not use the state directory')).toBe(true)
})

test('a stop signal ends the run as a failure', async () => {
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('received SIGTERM')), 50)

  const { code, lines } = await runJob({ TARGET_URLS: `${server.base}/slow` }, { signal: controller.signal })

  expect(code).toBe(EXIT.FAILURE)
  expect(lines.some((line) => line.msg === 'job cancelled before finishing')).toBe(true)
})

test('the job deadline stops a run that takes too long', async () => {
  const { code, lines } = await runJob({ TARGET_URLS: `${server.base}/slow` }, { deadlineMs: 50 })

  expect(code).toBe(EXIT.FAILURE)
  expect(lines.some((line) => line.msg === 'job deadline exceeded')).toBe(true)
})
