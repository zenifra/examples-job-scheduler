export class ConfigError extends Error {}

export interface Config {
  targets: string[]
  requestTimeoutMs: number
  maxAttempts: number
  concurrency: number
  deadlineSeconds: number
  failOnDown: boolean
  webhookUrl: string | null
  stateDir: string | null
}

type Env = Record<string, string | undefined>

const MAX_TARGETS = 50

function readInt(env: Env, name: string, fallback: number, { min, max }: { min: number, max: number }): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function readBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (['true', '1', 'yes'].includes(raw)) return true
  if (['false', '0', 'no'].includes(raw)) return false
  throw new ConfigError(`${name} must be true or false`)
}

function readUrl(name: string, raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError(`${name} contains an invalid URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`${name} only accepts http:// or https:// URLs`)
  }
  return url.toString()
}

// Reads and validates every setting up front, so a bad value fails the run
// immediately instead of halfway through the work.
export function loadConfig(env: Env = Bun.env): Config {
  const targets = (env.TARGET_URLS ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  if (targets.length === 0) {
    throw new ConfigError('TARGET_URLS is required: a comma-separated list of URLs to check')
  }
  if (targets.length > MAX_TARGETS) {
    throw new ConfigError(`TARGET_URLS accepts at most ${MAX_TARGETS} URLs`)
  }

  const webhookUrl = env.WEBHOOK_URL?.trim()

  return {
    targets: [...new Set(targets.map((target) => readUrl('TARGET_URLS', target)))],
    // Capped at 20 s so an in-flight request always ends within the 30 s the platform
    // waits after asking the job to stop.
    requestTimeoutMs: readInt(env, 'REQUEST_TIMEOUT_MS', 10_000, { min: 100, max: 20_000 }),
    maxAttempts: readInt(env, 'MAX_ATTEMPTS', 3, { min: 1, max: 5 }),
    concurrency: readInt(env, 'CONCURRENCY', 5, { min: 1, max: 20 }),
    // Kept well below the platform's 60-minute limit so the job can report and exit on its own terms.
    deadlineSeconds: readInt(env, 'JOB_DEADLINE_SECONDS', 300, { min: 10, max: 3300 }),
    failOnDown: readBool(env, 'FAIL_ON_DOWN', true),
    webhookUrl: webhookUrl ? readUrl('WEBHOOK_URL', webhookUrl) : null,
    stateDir: env.STATE_DIR?.trim() || null,
  }
}
