import http from 'node:http'
import https from 'node:https'

const USER_AGENT = 'zenifra-uptime-job/1.0'
const MAX_REDIRECTS = 5

// Uses node:http(s) instead of fetch on purpose: fetch loads undici, which more than
// doubles the memory of a small job (about 34 MiB instead of 15 MiB at peak), and the
// smallest Job plan has 64 MiB. Resolves with the status code; the body is discarded.
export function request(url, { method = 'GET', headers = {}, body, signal, redirectsLeft = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const client = target.protocol === 'https:' ? https : http
    const req = client.request(target, { method, headers: { 'user-agent': USER_AGENT, ...headers }, signal }, (res) => {
      res.resume()
      const location = res.headers.location
      if (method === 'GET' && res.statusCode >= 300 && res.statusCode < 400 && location && redirectsLeft > 0) {
        resolve(request(new URL(location, target).toString(), { method, headers, signal, redirectsLeft: redirectsLeft - 1 }))
        return
      }
      resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300 })
    })
    req.on('error', reject)
    req.end(body)
  })
}
