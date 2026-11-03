import { dispatchPublication, TARGET, type Env } from "./publisher.js"

type QueueRecord = { pending: boolean; failures: number; notBefore: number }
type Storage = {
	get<T>(key: string): Promise<T | undefined>
	put(entries: Record<string, unknown>): Promise<void>
	delete(keys: string[]): Promise<unknown>
	list<T>(options: { prefix: string; end?: string; limit: number }): Promise<Map<string, T>>
	getAlarm(): Promise<number | null>
	setAlarm(time: number): Promise<void>
}
type State = {
	storage: Storage
	blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

export const BATCH_DELAY = 20_000
export const DISPATCH_GRACE = 60_000
export const EVENT_TTL = 48 * 60 * 60 * 1000
const ACTIVE_STATUSES = ["queued", "pending", "requested", "in_progress", "waiting"]
const expiryKey = (time: number, id: string) => `expiry:${String(time).padStart(13, "0")}:${id}`

export class PublicationQueue {
	constructor(private readonly state: State, private readonly env: Env,
		private readonly fetcher: typeof fetch = fetch) {}

	private async record(): Promise<QueueRecord> {
		return await this.state.storage.get<QueueRecord>("queue") ?? { pending: false, failures: 0, notBefore: 0 }
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })
		let id: unknown
		try { id = (await request.json() as { id?: unknown }).id } catch {
			return new Response("Invalid event", { status: 400 })
		}
		if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) {
			return new Response("Invalid event", { status: 400 })
		}
		const eventId = id
		return this.state.blockConcurrencyWhile(async () => {
			const now = Date.now()
			const queue = await this.record()
			const expiry = await this.state.storage.get<number>(`event:${eventId}`)
			if (expiry && expiry > now) {
				if (queue.pending && !await this.state.storage.getAlarm()) {
					await this.state.storage.setAlarm(Math.max(now + BATCH_DELAY, queue.notBefore))
				}
				return new Response("Already queued")
			}
			const alarm = await this.state.storage.getAlarm()
			// Schedule first so an acknowledged durable event always has a wake-up.
			if (!queue.pending || alarm === null || alarm <= now) {
				await this.state.storage.setAlarm(Math.max(now + BATCH_DELAY, queue.notBefore))
			}
			const expires = now + EVENT_TTL
			await this.state.storage.put({
				queue: { ...queue, pending: true },
				[`event:${eventId}`]: expires,
				[expiryKey(expires, eventId)]: eventId,
			})
			return new Response("Queued")
		})
	}

	private async prune(): Promise<void> {
		const expired = await this.state.storage.list<string>({
			prefix: "expiry:", end: expiryKey(Date.now(), "~"), limit: 64,
		})
		const keys: string[] = []
		for (const [key, id] of expired) {
			keys.push(key)
			const current = await this.state.storage.get<number>(`event:${id}`)
			if (current === Number(key.split(":")[1])) keys.push(`event:${id}`)
		}
		if (keys.length) await this.state.storage.delete(keys)
	}

	private async busy(): Promise<boolean> {
		if (!this.env.GITHUB_ACTIONS_TOKEN) throw new Error("GitHub credential missing")
		const fetcher = this.fetcher
		const results = await Promise.all(ACTIVE_STATUSES.map(async status => {
			const response = await fetcher(
				`https://api.github.com/repos/${TARGET.repository}/actions/workflows/${TARGET.workflow}/runs?status=${status}&per_page=1`,
				{ headers: { Authorization: `Bearer ${this.env.GITHUB_ACTIONS_TOKEN}`,
					Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
					"User-Agent": "notion-gmeek-webhook" }, signal: AbortSignal.timeout(8000) })
			if (!response.ok) throw new Error(`GitHub run lookup failed (HTTP ${response.status}, status ${status})`)
			const body = await response.json() as { workflow_runs?: unknown[] }
			if (!Array.isArray(body.workflow_runs)) throw new Error("Invalid GitHub run response")
			return body.workflow_runs.length > 0
		}))
		return results.some(Boolean)
	}

	async alarm(): Promise<void> {
		await this.state.blockConcurrencyWhile(async () => {
			await this.prune()
			const queue = await this.record()
			if (!queue.pending) {
				const first = await this.state.storage.list<string>({ prefix: "expiry:", limit: 1 })
				const key = first.keys().next().value
				if (key) await this.state.storage.setAlarm(Math.max(Date.now() + 1000, Number(key.split(":")[1])))
				return
			}
			if (queue.notBefore > Date.now()) {
				await this.state.storage.setAlarm(queue.notBefore)
				return
			}
			try {
				if (await this.busy()) {
					queue.notBefore = Date.now() + DISPATCH_GRACE
				} else {
					await dispatchPublication(this.env, this.fetcher)
					queue.pending = false
					queue.failures = 0
					queue.notBefore = Date.now() + DISPATCH_GRACE
				}
			} catch (error) {
				queue.failures = Math.min(queue.failures + 1, 5)
				queue.notBefore = Date.now() + Math.min(300_000, 30_000 * 2 ** (queue.failures - 1))
				const reason = error instanceof Error && error.message.startsWith("GitHub ")
					? error.message : "GitHub request failed"
				console.error("Publication queue will retry", reason)
			}
			// The alarm is stored before clearing work; a crash can retry, never drop it.
			await this.state.storage.setAlarm(queue.notBefore)
			await this.state.storage.put({ queue })
		})
	}
}
