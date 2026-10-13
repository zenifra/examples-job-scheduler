import { createLogger, run } from './main'
import { listenForStopSignals } from './shutdown'

const log = createLogger()
const stop = listenForStopSignals(log)

try {
  const code = await run({ signal: stop.signal, log })
  // After a stop signal, exit with its conventional code (143 for SIGTERM) instead of the run result.
  process.exitCode = stop.exitCode() ?? code
} catch (error) {
  log.error('unexpected error', { reason: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined })
  process.exitCode = 1
}
