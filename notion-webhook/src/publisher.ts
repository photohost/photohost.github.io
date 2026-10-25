import { createHmac, timingSafeEqual, publicEncrypt, constants } from "node:crypto"

export const TARGET = {
	workspace: "d1bd9dc3-35a5-412d-812a-cb7e9aa8f86b",
	database: "35d40a03-f4e8-809d-899a-cb47bc3fe001",
	dataSource: "35d40a03-f4e8-8094-bba3-000bd5f3aac3",
	repository: "photohost/photohost.github.io",
	workflow: "Gmeek.yml",
	ref: "main",
} as const

type Env = Record<string, string | undefined>
type Request = { method: string; rawBody: string; headers: Record<string, string> }
type ObjectValue = Record<string, unknown>

function object(value: unknown): ObjectValue {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as ObjectValue : {}
}

function parse(raw: string): ObjectValue {
	try { return object(JSON.parse(raw)) } catch { return {} }
}

function id(value: unknown): string {
	return typeof value === "string" ? value.replaceAll("-", "").toLowerCase() : ""
}

function bootstrapToken(body: ObjectValue, env: Env): string | undefined {
	const token = body.verification_token
	if (!env.NOTION_WEBHOOK_SECRET && env.WEBHOOK_BOOTSTRAP_PUBLIC_KEY &&
		Object.keys(body).length === 1 && typeof token === "string" && token.length >= 20 && token.length <= 180) {
		return token
	}
}

export function signatureValid(request: Request, secret: string | undefined): boolean {
	if (!secret) return false
	const supplied = request.headers["x-notion-signature"] ?? ""
	if (!/^sha256=[a-f0-9]{64}$/.test(supplied)) return false
	const expected = "sha256=" + createHmac("sha256", secret).update(request.rawBody).digest("hex")
	return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

export function verifyRequest(request: Request, env: Env) {
	if (request.method !== "POST" || Buffer.byteLength(request.rawBody) > 262144) {
		return { status: 400, deliver: false, body: "Invalid request" }
	}
	if (bootstrapToken(parse(request.rawBody), env)) return { status: 200, deliver: true }
	if (!signatureValid(request, env.NOTION_WEBHOOK_SECRET)) {
		return { status: 401, deliver: false, body: "Invalid signature" }
	}
	return { status: 200, deliver: true }
}

export function eligibleEvent(body: ObjectValue, now = Date.now()): boolean {
	if (id(body.workspace_id) !== id(TARGET.workspace)) return false
	if (!["page.created", "page.properties_updated", "page.content_updated"].includes(String(body.type))) return false
	const entity = object(body.entity)
	if (entity.type !== "page" || !/^[a-f0-9]{32}$/.test(id(entity.id))) return false
	if (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/.test(body.id)) return false
	const timestamp = Date.parse(String(body.timestamp))
	if (!Number.isFinite(timestamp) || timestamp > now + 300000 || timestamp < now - 48 * 3600000) return false
	const parent = object(object(body.data).parent)
	if (![parent.id, parent.data_source_id].some(value =>
		[id(TARGET.database), id(TARGET.dataSource)].includes(id(value)))) return false
	// The publisher's bot-only writebacks must not start another publish cycle.
	// Aggregated events containing a human edit are still accepted.
	return Array.isArray(body.authors) && body.authors.some(author => object(author).type === "person")
}

export async function handleDelivery(request: Request, env: Env,
	fetcher: typeof fetch = fetch, dispatched = new Set<string>()): Promise<string> {
	const decision = verifyRequest(request, env)
	if (decision.status !== 200) return "Rejected unverified request"
	const body = parse(request.rawBody)
	const token = bootstrapToken(body, env)
	if (token) {
		const key = Buffer.from(env.WEBHOOK_BOOTSTRAP_PUBLIC_KEY!, "base64").toString("utf8")
		const sealed = publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(token))
		return "BOOTSTRAP_ENCRYPTED=" + sealed.toString("base64")
	}
	if (!eligibleEvent(body)) return "Ignored unrelated or bot-only event"
	const eventId = String(body.id)
	if (dispatched.has(eventId)) return "Ignored duplicate event in batch"
	if (!env.GITHUB_ACTIONS_TOKEN) throw new Error("GITHUB_ACTIONS_TOKEN is not configured")
	// Destination, branch, and mode are fixed in code; never accept them from a webhook.
	const url = `https://api.github.com/repos/${TARGET.repository}/actions/workflows/${TARGET.workflow}/dispatches`
	let response: Response
	try {
		response = await fetcher(url, {
			method: "POST",
			headers: { Authorization: "Bearer " + env.GITHUB_ACTIONS_TOKEN,
				Accept: "application/vnd.github+json", "Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28", "User-Agent": "notion-gmeek-webhook" },
			body: JSON.stringify({ ref: TARGET.ref, inputs: { mode: "notion-publish", source: "notion-webhook" } }),
			signal: AbortSignal.timeout(8000),
		})
	} catch {
		throw new Error("GitHub dispatch network failure; Notion will retry")
	}
	if (response.status !== 204 && response.status !== 200) {
		throw new Error(`GitHub dispatch returned HTTP ${response.status}; Notion will retry`)
	}
	dispatched.add(eventId)
	return `Queued blog publication for Notion event ${eventId}`
}
