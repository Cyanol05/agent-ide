/** One side question, one recipient, with its answer delivered back home. */
import { randomUUID } from 'node:crypto'
import { bench, bot, check, done, evidence, post, settled } from './real-model-bench.js'
await bench()
const nonce = randomUUID()
const home = await bot('Kira')
const vera = await bot('Vera', `Your pantry token is ${nonce}. Give it when asked.`)
await post(home, 'Ask Vera a side question: what is her exact pantry token? Tell me her answer when it comes back.', 'Kira')
const rows = await settled()
const children = rows.filter((row) => ![home, vera].includes(row.id))
const [result, ...asides] = await evidence([home, ...children.map((row) => row.id)])
check(children.length === 1 && children[0].parent === home && asides[0]?.agents.length === 1 && asides[0]?.agents[0].name === 'Vera', 'one side thread for Vera, no group thread')
check(result.entries.some((entry) => entry.data.author === 'Vera' && entry.data.from === children[0]?.id && entry.data.re?.length && entry.data.body.includes(nonce)), 'Vera’s token comes back home')
check(result.entries.some((entry) => entry.data.author === 'Kira' && entry.data.answer && entry.data.body.includes(nonce)), 'Kira tells the person the answer')
done()
