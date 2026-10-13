import type { Logger } from './main'

// Graceful shutdown: how a scheduled job should react when Zenifra stops it.
//
// When a run is cancelled, or the Job is paused or deleted, Zenifra sends SIGTERM to the task
// and waits up to 30 seconds before killing it. In that window a well-behaved job:
//   1. stops starting new work;
//   2. aborts (or quickly finishes) the work in flight;
//   3. leaves its data consistent: this example only writes its state file after a complete run;
//   4. logs what happened and exits with 128 + the signal number (143 for SIGTERM).
// SIGINT (Ctrl+C) gets the same treatment, which makes the behaviour easy to try locally.

const EXIT_CODES = { SIGTERM: 143, SIGINT: 130 } as const

// Leave on our own well before Zenifra's 30-second limit if some work ignores the abort.
export const FORCED_EXIT_AFTER_MS = 20_000

export interface StopSignals {
  // Fires on SIGTERM/SIGINT; pass it to everything that does work.
  signal: AbortSignal
  // Code to exit with once the work has stopped, or null while no signal arrived.
  exitCode: () => number | null
}

interface StopSignalOptions {
  exit?: (code: number) => void
  forcedExitAfterMs?: number
}

export function listenForStopSignals(log: Logger, { exit = process.exit, forcedExitAfterMs = FORCED_EXIT_AFTER_MS }: StopSignalOptions = {}): StopSignals {
  const controller = new AbortController()
  let exitCode: number | null = null

  for (const [name, code] of Object.entries(EXIT_CODES)) {
    process.once(name, () => {
      log.warn('stop signal received', { signal: name })
      exitCode = code
      controller.abort(new Error(`received ${name}`))
      setTimeout(() => exit(code), forcedExitAfterMs).unref()
    })
  }

  return { signal: controller.signal, exitCode: () => exitCode }
}
