export interface RecordedRequest { method: string, path: string, body: string }

// Local HTTP server with a few fixed routes, so tests never depend on the internet.
export function startServer() {
  const requests: RecordedRequest[] = []
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const path = new URL(request.url).pathname
      requests.push({ method: request.method, path, body: await request.text() })
      if (path === '/ok' || path === '/hook') return new Response('ok')
      if (path === '/missing') return new Response(null, { status: 404 })
      if (path === '/hook-fail') return new Response(null, { status: 500 })
      if (path === '/slow') return Bun.sleep(2_000).then(() => new Response('ok'))
      return new Response(null, { status: 503 })
    },
  })
  return { base: `http://127.0.0.1:${server.port}`, requests, close: () => server.stop(true) }
}

export function memoryLogger() {
  const lines: Record<string, any>[] = []
  const stream = { write: (line: string) => lines.push(JSON.parse(line)) }
  return { lines, stdout: stream, stderr: stream }
}
