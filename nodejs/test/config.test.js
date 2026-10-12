import assert from 'node:assert/strict'
import test from 'node:test'

import { ConfigError, loadConfig } from '../src/config.js'

test('applies defaults and removes duplicate targets', () => {
  const config = loadConfig({ TARGET_URLS: 'https://example.com/, https://example.com/,http://example.org' })

  assert.deepEqual(config, {
    targets: ['https://example.com/', 'http://example.org/'],
    requestTimeoutMs: 10_000,
    maxAttempts: 3,
    concurrency: 5,
    deadlineSeconds: 300,
    failOnDown: true,
    webhookUrl: null,
    stateDir: null,
  })
})

test('reads every optional setting', () => {
  const config = loadConfig({
    TARGET_URLS: 'https://example.com',
    REQUEST_TIMEOUT_MS: '2500',
    MAX_ATTEMPTS: '1',
    CONCURRENCY: '2',
    JOB_DEADLINE_SECONDS: '60',
    FAIL_ON_DOWN: 'false',
    WEBHOOK_URL: 'https://hooks.example.com/abc',
    STATE_DIR: '/data',
  })

  assert.equal(config.requestTimeoutMs, 2500)
  assert.equal(config.maxAttempts, 1)
  assert.equal(config.concurrency, 2)
  assert.equal(config.deadlineSeconds, 60)
  assert.equal(config.failOnDown, false)
  assert.equal(config.webhookUrl, 'https://hooks.example.com/abc')
  assert.equal(config.stateDir, '/data')
})

test('rejects invalid settings with a clear message', () => {
  const cases = [
    [{}, /TARGET_URLS is required/],
    [{ TARGET_URLS: 'not a url' }, /invalid URL/],
    [{ TARGET_URLS: 'ftp://example.com' }, /only accepts http/],
    [{ TARGET_URLS: 'https://example.com', MAX_ATTEMPTS: '0' }, /MAX_ATTEMPTS must be an integer between 1 and 5/],
    [{ TARGET_URLS: 'https://example.com', JOB_DEADLINE_SECONDS: '3600' }, /JOB_DEADLINE_SECONDS/],
    [{ TARGET_URLS: 'https://example.com', FAIL_ON_DOWN: 'maybe' }, /FAIL_ON_DOWN must be true or false/],
    [{ TARGET_URLS: Array.from({ length: 51 }, (_, i) => `https://e${i}.com`).join(',') }, /at most 50/],
  ]

  for (const [env, message] of cases) {
    assert.throws(() => loadConfig(env), (error) => error instanceof ConfigError && message.test(error.message))
  }
})
