import os
import requests
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.environ.get("RUNPOD_API_KEY")
ENDPOINT_ID = os.environ.get("RUNPOD_FLUX_ENDPOINT_ID")

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}"
}

query = """
query GetEndpoint($id: String!) {
  endpoint(id: $id) {
    id
    name
    templateId
  }
}
"""

res = requests.post("https://api.runpod.io/graphql", json={"query": query, "variables": {"id": ENDPOINT_ID}}, headers=headers)
print(res.json())

