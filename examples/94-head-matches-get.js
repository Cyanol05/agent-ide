/** HEAD on a static file answers the way GET does: same status and headers, no body */
import { base, check, done, server } from './lib.js'

await server()

const path = '/fonts/iAWriterQuattroS-Regular.woff2'
const get = await fetch(base + path)
const got = await get.arrayBuffer()
const head = await fetch(base + path, { method: 'HEAD' })
const headBody = await head.arrayBuffer()

check(head.status === get.status, 'HEAD on a static file gets the same status as GET', head.status)
check(
	head.headers.get('content-type') === get.headers.get('content-type'),
	'HEAD on a static file gets the same content-type as GET',
)
check(headBody.byteLength === 0, 'HEAD on a static file has no body', headBody.byteLength)
check(got.byteLength > 0, 'GET on the same file still has a body', got.byteLength)
done()
