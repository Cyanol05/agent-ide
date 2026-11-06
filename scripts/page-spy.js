/** A page's traffic and jank, for an agent watching agent-ide in a browser: load it before the page's own scripts,
 * `agent-browser --session <yours> open --init-script scripts/page-spy.js <url>`, then read it back with
 * `agent-browser --session <yours> eval 'JSON.stringify(spy)'`.
 * spy.fetches: each request as `ms path`; spy.socket: each /ws frame as `ms first-160-chars`; spy.long: main-thread stalls as `ms:duration` */
{
	window.spy = { fetches: [], socket: [], sockets: 0, long: [] }
	const now = () => Math.round(performance.now())
	const fetch = window.fetch
	window.fetch = function (url, ...rest) {
		spy.fetches.push(`${now()} ${String(url).replace(location.origin, '')}`)
		return fetch.call(this, url, ...rest)
	}
	const WebSocket = window.WebSocket
	window.WebSocket = function (...args) {
		const socket = new WebSocket(...args)
		spy.sockets++
		socket.addEventListener('message', (event) => spy.socket.push(`${now()} ${String(event.data).slice(0, 160)}`))
		return socket
	}
	window.WebSocket.prototype = WebSocket.prototype
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) spy.long.push(`${Math.round(entry.startTime)}:${Math.round(entry.duration)}`)
	}).observe({ type: 'longtask', buffered: true })
}
