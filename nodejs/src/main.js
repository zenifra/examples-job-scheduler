import { checkTarget, mapWithConcurrency } from './check.js'
import { ConfigError, loadConfig } from './config.js'
import { diffState, readState, writeState } from './state.js'

export const EXIT = { SUCCESS: 0, FAILURE: 1, CONFIG: 2 }

// One JSON object per line: easy to read in the run logs and easy to search.
export function createLogger({ stdout = process.stdout, stderr = process.stderr } = {}) {
  const write = (stream, level) => (msg, fields = {}) => {
    stream.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`)
  }
  return { info: write(stdout, 'info'), warn: write(stdout, 'warn'), error: write(stderr, 'error') }
}

function summarize(results, changes) {
  const down = results.filter((result) => !result.ok)
  const lines = [`Uptime check: ${results.length - down.length}/${results.length} targets up.`]
  for (const result of down) lines.push(`DOWN ${result.url} (${result.error})`)
  for (const change of changes) lines.push(`CHANGED ${change.url}: ${change.from} -> ${change.to}`)
  return lines.join('\n')
}

async function notify(config, text, signal, fetchImpl) {
  const timeout = AbortSignal.timeout(config.requestTimeoutMs)
  const response = await fetchImpl(config.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.any([signal, timeout]),
  })
  await response.body?.cancel()
  if (!response.ok) throw new Error(`webhook answered HTTP ${response.status}`)
}

// Runs the job once and resolves with the process exit code.
// `signal` is aborted when the platform asks the job to stop (SIGTERM).
export async function run({ env = process.env, signal = new AbortController().signal, fetchImpl = fetch, log = createLogger(), deadlineMs } = {}) {
  let config
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
      if (result.ok) log.info('target up', result)
      else log.warn('target down', result)
    }

    // The state lives in the persistent directory, so it survives between runs.
    // It is optional: a state problem is logged and never fails the check itself.
    let changes = []
    if (config.stateDir) {
      try {
        changes = diffState(await readState(config.stateDir), results)
        await writeState(config.stateDir, results)
      } catch (error) {
        log.warn('could not use the state directory', { stateDir: config.stateDir, reason: error.message })
      }
    }

    const down = results.filter((result) => !result.ok)
    if (config.webhookUrl && (down.length > 0 || changes.length > 0)) {
      try {
        await notify(config, summarize(results, changes), jobSignal, fetchImpl)
        log.info('notification sent', { webhookHost: new URL(config.webhookUrl).host })
      } catch (error) {
        if (jobSignal.aborted) throw error
        // Never log the webhook URL itself: it usually carries a secret token.
        log.error('notification failed', { webhookHost: new URL(config.webhookUrl).host, reason: error.message })
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
