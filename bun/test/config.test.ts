import { expect, test } from 'bun:test'

import { ConfigError, loadConfig } from '../src/config'

test('applies defaults and removes duplicate targets', () => {
  expect(loadConfig({ TARGET_URLS: 'https://example.com/, https://example.com/,http://example.org' })).toEqual({
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

  expect(config).toMatchObject({
    requestTimeoutMs: 2500,
    maxAttempts: 1,
    concurrency: 2,
    deadlineSeconds: 60,
    failOnDown: false,
    webhookUrl: 'https://hooks.example.com/abc',
    stateDir: '/data',
  })
})

test.each([
  [{}, /TARGET_URLS is required/],
  [{ TARGET_URLS: 'not a url' }, /invalid URL/],
  [{ TARGET_URLS: 'ftp://example.com' }, /only accepts http/],
  [{ TARGET_URLS: 'https://example.com', MAX_ATTEMPTS: '0' }, /MAX_ATTEMPTS must be an integer between 1 and 5/],
  [{ TARGET_URLS: 'https://example.com', JOB_DEADLINE_SECONDS: '3600' }, /JOB_DEADLINE_SECONDS/],
  [{ TARGET_URLS: 'https://example.com', FAIL_ON_DOWN: 'maybe' }, /FAIL_ON_DOWN must be true or false/],
  [{ TARGET_URLS: Array.from({ length: 51 }, (_, i) => `https://e${i}.com`).join(',') }, /at most 50/],
] as const)('rejects invalid settings: %p', (env, message) => {
  expect(() => loadConfig(env)).toThrow(ConfigError)
  expect(() => loadConfig(env)).toThrow(message)
})
