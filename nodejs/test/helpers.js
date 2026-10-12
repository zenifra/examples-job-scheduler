import { createServer } from 'node:http'

// Local HTTP server with a few fixed routes, so tests never depend on the internet.
export async function startServer() {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body })
      if (req.url === '/ok' || req.url === '/hook') return res.writeHead(200).end('ok')
      if (req.url === '/missing') return res.writeHead(404).end()
      if (req.url === '/redirect') return res.writeHead(302, { location: '/ok' }).end()
      if (req.url === '/loop') return res.writeHead(302, { location: '/loop' }).end()
      if (req.url === '/hook-fail') return res.writeHead(500).end()
      if (req.url === '/slow') return setTimeout(() => res.writeHead(200).end(), 2_000)
      res.writeHead(503).end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base,
    requests,
    close: () => new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    }),
  }
}

export function memoryLogger() {
  const lines = []
  const stream = { write: (line) => lines.push(JSON.parse(line)) }
  return { lines, stdout: stream, stderr: stream }
}
