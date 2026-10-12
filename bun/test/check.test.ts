import { afterAll, expect, test } from 'bun:test'

import { checkTarget, mapWithConcurrency } from '../src/check'
import { startServer } from './helpers'

const server = startServer()
const options = { requestTimeoutMs: 1_000, maxAttempts: 3, wait: async () => {} }

afterAll(() => server.close())

test('a 2xx answer is up after one attempt', async () => {
  expect(await checkTarget(`${server.base}/ok`, options)).toMatchObject({ ok: true, status: 200, attempts: 1, error: null })
})

test('a retryable status is tried again up to the limit', async () => {
  expect(await checkTarget(`${server.base}/unavailable`, options)).toMatchObject({ ok: false, status: 503, attempts: 3, error: 'HTTP 503' })
})

test('a non-retryable status fails without retrying', async () => {
  expect(await checkTarget(`${server.base}/missing`, options)).toMatchObject({ ok: false, status: 404, attempts: 1 })
})

test('a slow target times out', async () => {
  const result = await checkTarget(`${server.base}/slow`, { ...options, requestTimeoutMs: 100, maxAttempts: 1 })

  expect(result).toMatchObject({ ok: false, status: null, error: 'timeout after 100 ms' })
})

test('an aborted job stops checking instead of reporting the target as down', async () => {
  const controller = new AbortController()
  controller.abort(new Error('received SIGTERM'))

  await expect(checkTarget(`${server.base}/ok`, { ...options, signal: controller.signal })).rejects.toThrow('received SIGTERM')
})

test('mapWithConcurrency keeps order and respects the limit', async () => {
  let running = 0
  let peak = 0
  const results = await mapWithConcurrency([30, 10, 20, 5], 2, async (ms, index) => {
    running += 1
    peak = Math.max(peak, running)
    await Bun.sleep(ms)
    running -= 1
    return index
  })

  expect(results).toEqual([0, 1, 2, 3])
  expect(peak).toBe(2)
})
