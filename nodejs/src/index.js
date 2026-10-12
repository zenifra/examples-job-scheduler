import { createLogger, run } from './main.js'

const log = createLogger()
const controller = new AbortController()

// When a run is cancelled, paused or deleted, the platform sends SIGTERM and waits
// up to 30 seconds. Stop the work, let `run` log what happened, and exit.
for (const [name, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
  process.once(name, () => {
    log.warn('stop signal received', { signal: name })
    controller.abort(new Error(`received ${name}`))
    // Safety net in case something ignores the abort signal.
    setTimeout(() => process.exit(code), 20_000).unref()
  })
}

try {
  process.exitCode = await run({ signal: controller.signal, log })
} catch (error) {
  log.error('unexpected error', { reason: error.message, stack: error.stack })
  process.exitCode = 1
}
