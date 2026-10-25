import { Worker } from "@notionhq/workers"
import { handleDelivery, verifyRequest } from "./publisher.js"

const worker = new Worker()
export default worker

worker.webhook("publishBlog", {
	title: "Notion 部落格自動發布",
	description: "驗證 blog 資料庫的變更通知，觸發 Gmeek 處理 Published、repost 與 delete。",
	verify: (request) => verifyRequest(request, process.env),
	execute: async (events) => {
		const dispatched = new Set<string>()
		for (const event of events) {
			const result = await handleDelivery(event, process.env, fetch, dispatched)
			// Bootstrap output is RSA encrypted; never log the token or request body.
			console.log(result)
		}
	},
})
