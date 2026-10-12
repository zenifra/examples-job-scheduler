// Statuses worth a second try: the target may recover within the same run.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export interface CheckResult {
  url: string
  ok: boolean
  status: number | null
  attempts: number
  durationMs: number
  error: string | null
}

export interface CheckOptions {
  requestTimeoutMs: number
  maxAttempts: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export function backoffMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

export async function checkTarget(url: string, { requestTimeoutMs, maxAttempts, signal, fetchImpl = fetch, wait = sleep }: CheckOptions): Promise<CheckResult> {
  const startedAt = performance.now()
  let attempts = 0
  let status: number | null = null
  let error: string | null = null

  while (attempts < maxAttempts) {
    attempts += 1
    signal?.throwIfAborted()

    try {
      const timeout = AbortSignal.timeout(requestTimeoutMs)
      const response = await fetchImpl(url, {
        redirect: 'follow',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      // Only the status matters here; release the connection without reading the body.
      await response.body?.cancel()
      status = response.status
      error = response.ok ? null : `HTTP ${response.status}`
      if (response.ok || !RETRYABLE_STATUS.has(response.status)) break
    } catch (cause) {
      if (signal?.aborted) throw signal.reason
      status = null
      error = cause instanceof Error && cause.name === 'TimeoutError'
        ? `timeout after ${requestTimeoutMs} ms`
        : String(cause instanceof Error ? cause.message : cause)
    }

    if (attempts < maxAttempts) await wait(backoffMs(attempts), signal)
  }

  return { url, ok: error === null, status, attempts, durationMs: Math.round(performance.now() - startedAt), error }
}

// Runs `fn` over `items` with at most `limit` calls in flight, keeping the input order.
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
