import { eligibleEvent, handleDelivery, TARGET, verifyRequest, type Env } from "./publisher.js"
export { PublicationQueue } from "./queue.js"

type CloudflareEnv = Env & {
	PUBLICATION_QUEUE?: { getByName(name: string): { fetch(request: Request): Promise<Response> } }
}

async function boundedBody(request: Request): Promise<string | undefined> {
	if (Number(request.headers.get("content-length")) > 262144) return undefined
	const reader = request.body?.getReader()
	if (!reader) return ""
	const chunks: Uint8Array[] = []
	let size = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		size += value.byteLength
		if (size > 262144) { await reader.cancel(); return undefined }
		chunks.push(value)
	}
	const bytes = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

export async function receive(request: Request, env: CloudflareEnv, fetcher: typeof fetch = fetch): Promise<Response> {
	const path = new URL(request.url).pathname
	if (request.method === "GET" && path === "/health") return new Response("Gmeek webhook receiver (durable queue)")
	if (!env.WEBHOOK_PATH_TOKEN || path !== "/notion/" + env.WEBHOOK_PATH_TOKEN) return new Response("Not found", { status: 404 })
	if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })
	let rawBody: string | undefined
	try { rawBody = await boundedBody(request) } catch { return new Response("Invalid body", { status: 400 }) }
	if (rawBody === undefined) return new Response("Payload too large", { status: 413 })
	const delivery = { method: request.method, rawBody, headers: Object.fromEntries(request.headers.entries()) }
	const decision = verifyRequest(delivery, env)
	if (decision.status !== 200) return new Response("Invalid signature", { status: decision.status })
	try {
		if (!env.NOTION_WEBHOOK_SECRET) {
			console.log(await handleDelivery(delivery, env, fetcher))
			return new Response("Accepted", { status: 200 })
		}
		const body = JSON.parse(rawBody)
		if (!body || typeof body !== "object" || !eligibleEvent(body)) {
			return new Response("Ignored", { status: 200 })
		}
		if (!env.PUBLICATION_QUEUE) throw new Error("Publication queue is not configured")
		const result = await env.PUBLICATION_QUEUE.getByName(TARGET.repository).fetch(
			new Request("https://queue.internal/events", { method: "POST",
				body: JSON.stringify({ id: body.id }) }))
		if (!result.ok) throw new Error("Publication queue did not accept the event")
		console.log("Publication event durably accepted")
		return new Response("Accepted", { status: 200 })
	} catch {
		console.error("Queue acceptance failed; return 503 for Notion retry")
		return new Response("Try again later", { status: 503 })
	}
}

export default { fetch: (request: Request, env: CloudflareEnv) => receive(request, env) }

