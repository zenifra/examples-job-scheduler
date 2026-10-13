// Graceful shutdown: how a scheduled job should react when Zenifra stops it.
//
// When a run is cancelled, or the Job is paused or deleted, Zenifra sends SIGTERM to the task
// and waits up to 30 seconds before killing it. In that window a well-behaved job:
//   1. stops starting new work;
//   2. aborts (or quickly finishes) the work in flight;
//   3. leaves its data consistent: this example only writes its state file after a complete run;
//   4. logs what happened and exits with 128 + the signal number (143 for SIGTERM).
// SIGINT (Ctrl+C) gets the same treatment, which makes the behaviour easy to try locally.

const EXIT_CODES = { SIGTERM: 143, SIGINT: 130 }

// Leave on our own well before Zenifra's 30-second limit if some work ignores the abort.
export const FORCED_EXIT_AFTER_MS = 20_000

// Returns an AbortSignal that fires on SIGTERM/SIGINT; pass it to everything that does work.
// `exitCode()` is the code to exit with once the work has stopped (null while no signal arrived).
export function listenForStopSignals(log, { exit = process.exit } = {}) {
  const controller = new AbortController()
  let exitCode = null

  for (const [name, code] of Object.entries(EXIT_CODES)) {
    process.once(name, () => {
      log.warn('stop signal received', { signal: name })
      exitCode = code
      controller.abort(new Error(`received ${name}`))
      setTimeout(() => exit(code), FORCED_EXIT_AFTER_MS).unref()
    })
  }

  return { signal: controller.signal, exitCode: () => exitCode }
}
