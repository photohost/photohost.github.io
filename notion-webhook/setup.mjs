// Local setup only. Private keys and .env stay ignored by Git.
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

function setEnv(name, value) {
	const file = existsSync(".env") ? readFileSync(".env", "utf8") : ""
	const line = `${name}=${JSON.stringify(value)}`
	const pattern = new RegExp(`^${name}=.*$`, "m")
	writeFileSync(".env", pattern.test(file) ? file.replace(pattern, () => line) : file.trimEnd() + "\n" + line + "\n", { mode: 0o600 })
}

const command = process.argv[2]
if (command === "init") {
	if (existsSync(".bootstrap-private.pem")) throw new Error("Bootstrap key already exists; reuse it.")
	const keys = generateKeyPairSync("rsa", { modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
	writeFileSync(".bootstrap-private.pem", keys.privateKey, { mode: 0o600 })
	setEnv("WEBHOOK_BOOTSTRAP_PUBLIC_KEY", Buffer.from(keys.publicKey).toString("base64"))
	console.log("Bootstrap key created. Only the public key will be sent to Notion.")
} else if (command === "capture") {
	const logs = readFileSync(process.argv[3], "utf8")
	const encrypted = [...logs.matchAll(/BOOTSTRAP_ENCRYPTED=([A-Za-z0-9+/=]+)/g)]
	if (!encrypted.length) throw new Error("No encrypted verification token found in these worker logs.")
	let token
	for (const match of encrypted) {
		try {
			token = privateDecrypt({ key: readFileSync(".bootstrap-private.pem"),
				padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(match[1], "base64")).toString()
		} catch { /* A previous bootstrap key may have been used. */ }
	}
	if (!token) throw new Error("Verification token did not match this local bootstrap key.")
	setEnv("NOTION_WEBHOOK_SECRET", token)
	console.log("Verification token saved privately to .env; value not printed.")
} else if (command === "show-code") {
	// Run this yourself in a private terminal only when completing Notion verification.
	const value = readFileSync(".env", "utf8").match(/^NOTION_WEBHOOK_SECRET=(.+)$/m)?.[1]
	if (!value) throw new Error("Capture the verification token first.")
	console.log(JSON.parse(value))
} else {
	console.log("Usage: node setup.mjs init | capture <encrypted-log-file> | show-code")
}
