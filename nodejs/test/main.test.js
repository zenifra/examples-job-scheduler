import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, beforeEach, test } from 'node:test'

import { createLogger, EXIT, run } from '../src/main.js'
import { diffState } from '../src/state.js'
import { memoryLogger, startServer } from './helpers.js'

let server
let stateDir

before(async () => { server = await startServer() })
after(() => server.close())
beforeEach(async () => {
  server.requests.length = 0
  stateDir = await mkdtemp(join(tmpdir(), 'uptime-job-'))
})
afterEach(() => rm(stateDir, { recursive: true, force: true }))

async function runJob(env, signal) {
  const output = memoryLogger()
  const code = await run({ env: { MAX_ATTEMPTS: '1', ...env }, signal, log: createLogger(output) })
  return { code, lines: output.lines }
}

test('exits 0 when every target is up', async () => {
  const { code, lines } = await runJob({ TARGET_URLS: `${server.base}/ok` })

  assert.equal(code, EXIT.SUCCESS)
  assert.equal(lines.at(-1).msg, 'job finished')
  assert.equal(lines.at(-1).down, 0)
})

test('exits 1 when a target is down, unless FAIL_ON_DOWN=false', async () => {
  const env = { TARGET_URLS: `${server.base}/ok,${server.base}/missing` }

  assert.equal((await runJob(env)).code, EXIT.FAILURE)
  assert.equal((await runJob({ ...env, FAIL_ON_DOWN: 'false' })).code, EXIT.SUCCESS)
})

test('exits 2 on invalid configuration', async () => {
  const { code, lines } = await runJob({ TARGET_URLS: '' })

  assert.equal(code, EXIT.CONFIG)
  assert.equal(lines[0].level, 'error')
  assert.match(lines[0].reason, /TARGET_URLS is required/)
})

test('keeps state between runs and reports status changes to the webhook', async () => {
  const env = { STATE_DIR: stateDir, WEBHOOK_URL: `${server.base}/hook`, FAIL_ON_DOWN: 'false' }

  await runJob({ ...env, TARGET_URLS: `${server.base}/ok` })
  assert.equal(server.requests.filter((request) => request.url === '/hook').length, 0, 'nothing to report on a healthy first run')

  const state = JSON.parse(await readFile(join(stateDir, 'uptime-state.json'), 'utf8'))
  assert.equal(state.targets[`${server.base}/ok`].ok, true)

  const { lines } = await runJob({ ...env, TARGET_URLS: `${server.base}/ok,${server.base}/missing` })
  const hook = server.requests.find((request) => request.url === '/hook')
  assert.ok(hook, 'webhook called when a target is down')
  assert.match(JSON.parse(hook.body).text, /DOWN .*\/missing/)
  assert.ok(lines.some((line) => line.msg === 'notification sent'))
  assert.ok(!JSON.stringify(lines).includes('/hook'), 'webhook URL never logged')
})

test('diffState reports up/down transitions only', () => {
  const previous = { targets: { a: { ok: true }, b: { ok: false }, c: { ok: true } } }
  const results = [{ url: 'a', ok: false }, { url: 'b', ok: true }, { url: 'c', ok: true }, { url: 'd', ok: false }]

  assert.deepEqual(diffState(previous, results), [
    { url: 'a', from: 'up', to: 'down' },
    { url: 'b', from: 'down', to: 'up' },
  ])
  assert.deepEqual(diffState(null, results), [])
})

test('a failing webhook fails the run', async () => {
  const { code, lines } = await runJob({ TARGET_URLS: `${server.base}/missing`, WEBHOOK_URL: `${server.base}/hook-fail`, FAIL_ON_DOWN: 'false' })

  assert.equal(code, EXIT.FAILURE)
  assert.equal(lines.find((line) => line.msg === 'notification failed').reason, 'webhook answered HTTP 500')
})

test('an unwritable state directory is logged and does not fail the run', async () => {
  // A path below a regular file can never be created as a directory.
  const file = join(stateDir, 'not-a-directory')
  await writeFile(file, '')
  const { code, lines } = await runJob({ TARGET_URLS: `${server.base}/ok`, STATE_DIR: join(file, 'state') })

  assert.equal(code, EXIT.SUCCESS)
  assert.ok(lines.some((line) => line.msg === 'could not use the state directory'))
})

test('a stop signal ends the run as a failure', async () => {
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('received SIGTERM')), 50)

  const { code, lines } = await runJob({ TARGET_URLS: `${server.base}/slow` }, controller.signal)

  assert.equal(code, EXIT.FAILURE)
  assert.ok(lines.some((line) => line.msg === 'job cancelled before finishing'))
})

test('the job deadline stops a run that takes too long', async () => {
  const output = memoryLogger()
  const code = await run({ env: { TARGET_URLS: `${server.base}/slow` }, log: createLogger(output), deadlineMs: 50 })

  assert.equal(code, EXIT.FAILURE)
  assert.ok(output.lines.some((line) => line.msg === 'job deadline exceeded'))
})
