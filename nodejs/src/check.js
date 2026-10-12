import { setTimeout as sleep } from 'node:timers/promises'

// Statuses worth a second try: the target may recover within the same run.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export function backoffMs(attempt) {
  return 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)
}

export async function checkTarget(url, { requestTimeoutMs, maxAttempts, signal, fetchImpl = fetch, wait = sleep }) {
  const startedAt = performance.now()
  let attempts = 0
  let status = null
  let error = null

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
      error = cause.name === 'TimeoutError' ? `timeout after ${requestTimeoutMs} ms` : cause.message
    }

    if (attempts < maxAttempts) await wait(backoffMs(attempts), undefined, { signal })
  }

  return {
    url,
    ok: error === null,
    status,
    attempts,
    durationMs: Math.round(performance.now() - startedAt),
    error,
  }
}

// Runs `fn` over `items` with at most `limit` calls in flight, keeping the input order.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
