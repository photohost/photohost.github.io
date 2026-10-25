import assert from "node:assert/strict"
import { test } from "node:test"
import { createHmac, generateKeyPairSync, privateDecrypt, constants } from "node:crypto"
import { TARGET, eligibleEvent, verifyRequest, handleDelivery } from "../dist/publisher.js"

const env = { NOTION_WEBHOOK_SECRET: "test-signature-secret", GITHUB_ACTIONS_TOKEN: "test-private-token" }
function payload(changes = {}) {
	return { id: "11111111-1111-4111-8111-111111111111", timestamp: new Date().toISOString(),
		workspace_id: TARGET.workspace, type: "page.properties_updated",
		entity: { id: "22222222-2222-4222-8222-222222222222", type: "page" },
		authors: [{ type: "person" }], data: { parent: { id: TARGET.database, data_source_id: TARGET.dataSource } }, ...changes }
}
function request(body, secret = env.NOTION_WEBHOOK_SECRET) {
	const rawBody = JSON.stringify(body)
	return { method: "POST", rawBody, headers: {
		"x-notion-signature": "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex") } }
}
const mustNotFetch = async () => { throw new Error("Unexpected GitHub request") }

test("GitHub dispatch accepts run information with HTTP 200", async () => {
	assert.match(await handleDelivery(request(payload()), env,
		async () => new Response('{"workflow_run_id":123}', { status: 200 })), /Queued/)
})

test("valid signature is accepted; altered payload and missing signatures rejected", () => {
	const req = request(payload())
	assert.equal(verifyRequest(req, env).status, 200)
	assert.equal(verifyRequest({ ...req, rawBody: req.rawBody + " " }, env).status, 401)
	assert.equal(verifyRequest({ ...req, headers: {} }, env).status, 401)
	assert.equal(verifyRequest(req, {}).status, 401)
})

test("large payload and wrong method rejected before dispatch", () => {
	assert.equal(verifyRequest({ ...request(payload()), rawBody: "x".repeat(262145) }, env).status, 400)
	assert.equal(verifyRequest({ ...request(payload()), method: "GET" }, env).status, 400)
})

test("only signed human events for this blog dispatch the fixed workflow", async () => {
	const calls = []
	const result = await handleDelivery(request(payload()), env, async (url, options) => {
		calls.push({ url, options })
		return new Response(null, { status: 204 })
	})
	assert.equal(calls.length, 1)
	assert.equal(calls[0].url, "https://api.github.com/repos/photohost/photohost.github.io/actions/workflows/Gmeek.yml/dispatches")
	assert.deepEqual(JSON.parse(calls[0].options.body), { ref: "main", inputs: { mode: "notion-publish", source: "notion-webhook" } })
	assert.match(result, /Queued blog publication/)
	assert.ok(!result.includes(env.GITHUB_ACTIONS_TOKEN))
})

test("bot writebacks do not create a publish loop", async () => {
	assert.match(await handleDelivery(request(payload({ authors: [{ type: "bot" }] })), env, mustNotFetch), /Ignored/)
	assert.match(await handleDelivery(request(payload({ authors: [] })), env, mustNotFetch), /Ignored/)
	assert.equal(eligibleEvent(payload({ authors: [{ type: "bot" }, { type: "person" }] })), true)
})

test("wrong workspace, database, type, and stale events are ignored", async () => {
	for (const changes of [{ workspace_id: "wrong" }, { data: { parent: { id: "another-database" } } },
		{ type: "comment.created" }, { entity: { type: "block" } },
		{ timestamp: "bad-date" }, { timestamp: "2020-01-01T00:00:00Z" },
		{ timestamp: new Date(Date.now() + 600000).toISOString() }]) {
		assert.match(await handleDelivery(request(payload(changes)), env, mustNotFetch), /Ignored/)
	}
})

test("content, creation, and normalized data-source parent IDs are supported", () => {
	for (const type of ["page.content_updated", "page.created", "page.properties_updated"]) {
		assert.equal(eligibleEvent(payload({ type, data: { parent: { id: TARGET.dataSource.replaceAll("-", "") } } })), true)
	}
})

test("unverified execute calls still cannot dispatch when ingress verification is disabled", async () => {
	assert.match(await handleDelivery(request(payload(), "wrong-secret"), env, mustNotFetch), /Rejected/)
})

test("repeated event in a delivered batch dispatches once", async () => {
	const seen = new Set()
	let calls = 0
	const fetcher = async () => { calls++; return new Response(null, { status: 204 }) }
	await handleDelivery(request(payload()), env, fetcher, seen)
	assert.match(await handleDelivery(request(payload()), env, fetcher, seen), /duplicate/)
	assert.equal(calls, 1)
})

test("GitHub failures throw without leaking response content, and remain retryable", async () => {
	const seen = new Set()
	await assert.rejects(handleDelivery(request(payload()), env, async () => new Response("sensitive", { status: 403 }), seen),
		{ message: "GitHub dispatch returned HTTP 403; Notion will retry" })
	assert.equal(seen.size, 0)
	await assert.rejects(handleDelivery(request(payload()), env, async () => { throw new Error("sensitive") }),
		{ message: "GitHub dispatch network failure; Notion will retry" })
})

test("missing GitHub credential fails clearly without dispatch", async () => {
	await assert.rejects(handleDelivery(request(payload()), { NOTION_WEBHOOK_SECRET: env.NOTION_WEBHOOK_SECRET }, mustNotFetch),
		{ message: "GITHUB_ACTIONS_TOKEN is not configured" })
})

test("bootstrap token is encrypted with a local-only private key and cannot dispatch", async () => {
	const keys = generateKeyPairSync("rsa", { modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
	const secret = "secret_test_verification_only"
	const bootstrapEnv = { WEBHOOK_BOOTSTRAP_PUBLIC_KEY: Buffer.from(keys.publicKey).toString("base64") }
	const req = { method: "POST", rawBody: JSON.stringify({ verification_token: secret }), headers: {} }
	const output = await handleDelivery(req, bootstrapEnv, mustNotFetch)
	assert.ok(!output.includes(secret))
	const decoded = privateDecrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
		Buffer.from(output.split("=").slice(1).join("="), "base64"))
	assert.equal(decoded.toString(), secret)
	assert.equal(verifyRequest(req, { ...bootstrapEnv, ...env }).status, 401)
	assert.equal(verifyRequest(req, {}).status, 401)
})
