import { checkTarget, mapWithConcurrency, type CheckResult } from './check'
import { ConfigError, loadConfig, type Config } from './config'
import { diffState, readState, writeState, type StatusChange } from './state'

export const EXIT = { SUCCESS: 0, FAILURE: 1, CONFIG: 2 } as const

type Fields = Record<string, unknown>
type LogFn = (msg: string, fields?: Fields) => void
export interface Logger { info: LogFn, warn: LogFn, error: LogFn }
interface Writable { write: (line: string) => unknown }

// One JSON object per line: easy to read in the run logs and easy to search.
export function createLogger({ stdout = process.stdout, stderr = process.stderr }: { stdout?: Writable, stderr?: Writable } = {}): Logger {
  const write = (stream: Writable, level: string): LogFn => (msg, fields = {}) => {
    stream.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`)
  }
  return { info: write(stdout, 'info'), warn: write(stdout, 'warn'), error: write(stderr, 'error') }
}

function summarize(results: CheckResult[], changes: StatusChange[]): string {
  const down = results.filter((result) => !result.ok)
  const lines = [`Uptime check: ${results.length - down.length}/${results.length} targets up.`]
  for (const result of down) lines.push(`DOWN ${result.url} (${result.error})`)
  for (const change of changes) lines.push(`CHANGED ${change.url}: ${change.from} -> ${change.to}`)
  return lines.join('\n')
}

async function notify(config: Config & { webhookUrl: string }, text: string, signal: AbortSignal, fetchImpl: typeof fetch) {
  const response = await fetchImpl(config.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]),
  })
  await response.body?.cancel()
  if (!response.ok) throw new Error(`webhook answered HTTP ${response.status}`)
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

export interface RunOptions {
  env?: Record<string, string | undefined>
  // Aborted when the platform asks the job to stop (SIGTERM).
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  log?: Logger
  deadlineMs?: number
}

// Runs the job once and resolves with the process exit code.
export async function run({ env = Bun.env, signal = new AbortController().signal, fetchImpl = fetch, log = createLogger(), deadlineMs }: RunOptions = {}): Promise<number> {
  let config: Config
  try {
    config = loadConfig(env)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    log.error('invalid configuration', { reason: error.message })
    return EXIT.CONFIG
  }

  const deadline = AbortSignal.timeout(deadlineMs ?? config.deadlineSeconds * 1000)
  const jobSignal = AbortSignal.any([signal, deadline])
  log.info('job started', { targets: config.targets.length, deadlineSeconds: config.deadlineSeconds })

  try {
    const results = await mapWithConcurrency(config.targets, config.concurrency, (url) =>
      checkTarget(url, { ...config, signal: jobSignal, fetchImpl }))

    for (const result of results) {
      if (result.ok) log.info('target up', { ...result })
      else log.warn('target down', { ...result })
    }

    // The state lives in the persistent directory, so it survives between runs.
    // It is optional: a state problem is logged and never fails the check itself.
    let changes: StatusChange[] = []
    if (config.stateDir) {
      try {
        changes = diffState(await readState(config.stateDir), results)
        await writeState(config.stateDir, results)
      } catch (error) {
        log.warn('could not use the state directory', { stateDir: config.stateDir, reason: reason(error) })
      }
    }

    const down = results.filter((result) => !result.ok)
    if (config.webhookUrl && (down.length > 0 || changes.length > 0)) {
      // Never log the webhook URL itself: it usually carries a secret token.
      const webhookHost = new URL(config.webhookUrl).host
      try {
        await notify({ ...config, webhookUrl: config.webhookUrl }, summarize(results, changes), jobSignal, fetchImpl)
        log.info('notification sent', { webhookHost })
      } catch (error) {
        if (jobSignal.aborted) throw error
        log.error('notification failed', { webhookHost, reason: reason(error) })
        return EXIT.FAILURE
      }
    }

    log.info('job finished', { up: results.length - down.length, down: down.length, changes: changes.length })
    return down.length > 0 && config.failOnDown ? EXIT.FAILURE : EXIT.SUCCESS
  } catch (error) {
    if (signal.aborted) {
      log.warn('job cancelled before finishing')
      return EXIT.FAILURE
    }
    if (deadline.aborted) {
      log.error('job deadline exceeded', { deadlineSeconds: config.deadlineSeconds })
      return EXIT.FAILURE
    }
    throw error
  }
}
