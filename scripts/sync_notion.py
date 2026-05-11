from notion_client import Client
import os

notion = Client(auth=os.environ["NOTION_TOKEN"])

database_id = os.environ["NOTION_DATABASE_ID"]

response = notion.databases.query(
    database_id=database_id
)

for page in response["results"]:
    title = page["properties"]["Title"]["title"][0]["plain_text"]

    print(title)
