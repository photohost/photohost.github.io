import { test } from "node:test"
import assert from "node:assert/strict"
import { PublicationQueue, BATCH_DELAY, DISPATCH_GRACE, EVENT_TTL } from "../dist/queue.js"

const env = { GITHUB_ACTIONS_TOKEN: "local-test-token" }
const eventId = number => `11111111-1111-4111-8111-${String(number).padStart(12, "0")}`
const request = number => new Request("https://internal/", {
	method: "POST", body: JSON.stringify({ id: eventId(number) }),
})

class MemoryStorage {
	values = new Map()
	alarm = null
	async get(key) { return structuredClone(this.values.get(key)) }
	async put(entries) {
		for (const [key, value] of Object.entries(entries)) this.values.set(key, structuredClone(value))
	}
	async delete(keys) { for (const key of keys) this.values.delete(key) }
	async list({ prefix, end, limit }) {
		return new Map([...this.values].filter(([key]) => key.startsWith(prefix) && (!end || key < end))
			.sort(([a], [b]) => a.localeCompare(b)).slice(0, limit))
	}
	async getAlarm() { return this.alarm }
	async setAlarm(time) { this.alarm = time }
}

function state(storage) {
	let tail = Promise.resolve()
	return { storage, blockConcurrencyWhile(callback) {
		const result = tail.then(callback)
		tail = result.catch(() => {})
		return result
	} }
}

function setup(t) {
	let now = 1_800_000_000_000
	t.mock.method(Date, "now", () => now)
	const storage = new MemoryStorage()
	const calls = []
	let busy = false, failLookup = false, failDispatch = false
	const fetcher = async (url, options) => {
		calls.push({ url, options })
		if (options.method === "POST") return new Response(null, { status: failDispatch ? 503 : 204 })
		assert.match(url, /^https:\/\/api\.github\.com\/repos\/photohost\/photohost\.github\.io\/actions\/workflows\/Gmeek\.yml\/runs\?/)
		if (failLookup) return new Response(null, { status: 403 })
		return Response.json({ workflow_runs: busy && new URL(url).searchParams.get("status") === "in_progress" ? [{ id: 1 }] : [] })
	}
	const queue = new PublicationQueue(state(storage), env, fetcher)
	return { queue, storage, fetcher, calls,
		dispatches: () => calls.filter(call => call.options.method === "POST").length,
		setBusy: value => { busy = value },
		setLookupFailure: value => { failLookup = value },
		setDispatchFailure: value => { failDispatch = value },
		advance: milliseconds => { now += milliseconds },
		fire: async (instance = queue) => {
			assert.ok(storage.alarm !== null)
			now = Math.max(now, storage.alarm)
			storage.alarm = null
			await instance.alarm()
		},
	}
}

test("separate requests coalesce without postponing the first alarm; duplicates survive restart", async t => {
	const h = setup(t)
	assert.equal((await h.queue.fetch(request(1))).status, 200)
	const firstAlarm = h.storage.alarm
	assert.equal(firstAlarm - Date.now(), BATCH_DELAY)
	h.advance(5000)
	await h.queue.fetch(request(2))
	assert.equal(h.storage.alarm, firstAlarm)
	const restarted = new PublicationQueue(state(h.storage), env, h.fetcher)
	assert.equal(await (await restarted.fetch(request(1))).text(), "Already queued")
	await h.fire(restarted)
	assert.equal(h.dispatches(), 1)
	await restarted.fetch(request(1))
	await h.fire(restarted)
	assert.equal(h.dispatches(), 1)
	assert.equal((await h.storage.get("queue")).pending, false)
})

test("an active workflow delays the batch and retains every command", async t => {
	const h = setup(t)
	h.setBusy(true)
	await h.queue.fetch(request(1))
	await h.fire()
	assert.equal(h.dispatches(), 0)
	assert.equal((await h.storage.get("queue")).pending, true)
	await h.queue.fetch(request(2))
	h.setBusy(false)
	await h.fire()
	assert.equal(h.dispatches(), 1)
	assert.ok(await h.storage.get(`event:${eventId(1)}`))
	assert.ok(await h.storage.get(`event:${eventId(2)}`))
})

test("lookup and dispatch failures retain durable work and schedule explicit backoff", async t => {
	const h = setup(t)
	h.setLookupFailure(true)
	await h.queue.fetch(request(1))
	await h.fire()
	assert.equal(h.dispatches(), 0)
	assert.equal((await h.storage.get("queue")).failures, 1)
	assert.equal(h.storage.alarm - Date.now(), 30_000)
	h.setLookupFailure(false)
	h.setDispatchFailure(true)
	await h.fire()
	assert.equal((await h.storage.get("queue")).pending, true)
	assert.equal(h.storage.alarm - Date.now(), 60_000)
	h.setDispatchFailure(false)
	const restarted = new PublicationQueue(state(h.storage), env, h.fetcher)
	await h.fire(restarted)
	assert.equal((await h.storage.get("queue")).pending, false)
	assert.equal((await h.storage.get("queue")).failures, 0)
	assert.equal(h.dispatches(), 2)
})

test("204 dispatch has a grace period before accepting a trailing batch", async t => {
	const h = setup(t)
	await h.queue.fetch(request(1))
	await h.fire()
	assert.equal(h.dispatches(), 1)
	const notBefore = Date.now() + DISPATCH_GRACE
	h.advance(1000)
	await h.queue.fetch(request(2))
	assert.equal(h.storage.alarm, notBefore)
	await h.fire()
	assert.equal(h.dispatches(), 2)
})

test("an event arriving during dispatch is retained for the next sync", async t => {
	const h = setup(t)
	let entered, resume
	const reachedDispatch = new Promise(resolve => { entered = resolve })
	const dispatchReply = new Promise(resolve => { resume = resolve })
	const fetcher = async (url, options) => {
		if (options.method === "POST") { entered(); await dispatchReply }
		return h.fetcher(url, options)
	}
	const queue = new PublicationQueue(state(h.storage), env, fetcher)
	await queue.fetch(request(1))
	const firing = h.fire(queue)
	await reachedDispatch
	const intake = queue.fetch(request(2))
	resume()
	await Promise.all([firing, intake])
	assert.equal(h.dispatches(), 1)
	assert.equal((await h.storage.get("queue")).pending, true)
	await h.fire(queue)
	assert.equal(h.dispatches(), 2)
})

test("expiry cleanup is bounded and eventually removes old duplicate receipts", async t => {
	const h = setup(t)
	for (let i = 1; i <= 130; i++) await h.queue.fetch(request(i))
	await h.fire()
	h.advance(EVENT_TTL)
	await h.fire()
	assert.equal([...h.storage.values.keys()].filter(key => key.startsWith("event:")).length, 66)
	await h.fire()
	await h.fire()
	assert.equal([...h.storage.values.keys()].filter(key => key.startsWith("event:")).length, 0)
	assert.equal(h.dispatches(), 1)
})

test("invalid internal requests never create pending publication", async t => {
	const h = setup(t)
	assert.equal((await h.queue.fetch(new Request("https://internal/"))).status, 405)
	assert.equal((await h.queue.fetch(new Request("https://internal/", { method: "POST", body: "null" }))).status, 400)
	assert.equal((await h.queue.fetch(new Request("https://internal/", { method: "POST", body: '{}' }))).status, 400)
	assert.equal(h.storage.alarm, null)
	assert.equal(h.calls.length, 0)
})
