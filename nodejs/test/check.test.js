import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { checkTarget, mapWithConcurrency } from '../src/check.js'
import { startServer } from './helpers.js'

let server
const noWait = async () => {}
const options = { requestTimeoutMs: 1_000, maxAttempts: 3, wait: noWait }

before(async () => { server = await startServer() })
after(() => server.close())

test('a 2xx answer is up after one attempt', async () => {
  const result = await checkTarget(`${server.base}/ok`, options)

  assert.equal(result.ok, true)
  assert.equal(result.status, 200)
  assert.equal(result.attempts, 1)
  assert.equal(result.error, null)
})

test('a retryable status is tried again up to the limit', async () => {
  const result = await checkTarget(`${server.base}/unavailable`, options)

  assert.equal(result.ok, false)
  assert.equal(result.status, 503)
  assert.equal(result.attempts, 3)
  assert.equal(result.error, 'HTTP 503')
})

test('a non-retryable status fails without retrying', async () => {
  const result = await checkTarget(`${server.base}/missing`, options)

  assert.equal(result.ok, false)
  assert.equal(result.status, 404)
  assert.equal(result.attempts, 1)
})

test('a slow target times out', async () => {
  const result = await checkTarget(`${server.base}/slow`, { ...options, requestTimeoutMs: 100, maxAttempts: 1 })

  assert.equal(result.ok, false)
  assert.equal(result.status, null)
  assert.equal(result.error, 'timeout after 100 ms')
})

test('an aborted job stops checking instead of reporting the target as down', async () => {
  const controller = new AbortController()
  controller.abort(new Error('received SIGTERM'))

  await assert.rejects(checkTarget(`${server.base}/ok`, { ...options, signal: controller.signal }), /received SIGTERM/)
})

test('mapWithConcurrency keeps order and respects the limit', async () => {
  let running = 0
  let peak = 0
  const results = await mapWithConcurrency([30, 10, 20, 5], 2, async (ms, index) => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, ms))
    running -= 1
    return index
  })

  assert.deepEqual(results, [0, 1, 2, 3])
  assert.equal(peak, 2)
})
