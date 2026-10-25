import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { receive } from "../dist/cloudflare.js"
import { TARGET } from "../dist/publisher.js"

const env = { WEBHOOK_PATH_TOKEN: "local-test-path", NOTION_WEBHOOK_SECRET: "local-test-signature", GITHUB_ACTIONS_TOKEN: "local-test-github" }
const event = { id: "11111111-1111-4111-8111-111111111111", timestamp: new Date().toISOString(),
	workspace_id: TARGET.workspace, type: "page.properties_updated", entity: { id: "22222222-2222-4222-8222-222222222222", type: "page" },
	authors: [{ type: "person" }], data: { parent: { id: TARGET.database } } }
function request(body = JSON.stringify(event), path = "/notion/local-test-path") {
	return new Request("https://worker.example" + path, { method: "POST", body,
		headers: { "x-notion-signature": "sha256=" + createHmac("sha256", env.NOTION_WEBHOOK_SECRET).update(body).digest("hex") } })
}
const noFetch = async () => { throw new Error("Should not dispatch") }

test("receiver requires the private path and signature", async () => {
	assert.equal((await receive(request(undefined, "/notion/wrong"), env, noFetch)).status, 404)
	const unsigned = new Request("https://worker.example/notion/local-test-path", { method: "POST", body: "{}" })
	assert.equal((await receive(unsigned, env, noFetch)).status, 401)
	assert.equal((await receive(request(), {}, noFetch)).status, 404)
})
test("receiver rejects large streamed bodies and non-POST requests", async () => {
	assert.equal((await receive(request("x".repeat(262145)), env, noFetch)).status, 413)
	assert.equal((await receive(new Request("https://worker.example/notion/local-test-path"), env, noFetch)).status, 405)
})
test("receiver acknowledges only successful dispatch and requests Notion retry on failure", async () => {
	assert.equal((await receive(request(), env, async () => new Response(null, { status: 204 }))).status, 200)
	assert.equal((await receive(request(), env, async () => new Response("private error", { status: 403 }))).status, 503)
	assert.equal((await receive(request(), env, async () => { throw new Error("private network error") })).status, 503)
})
