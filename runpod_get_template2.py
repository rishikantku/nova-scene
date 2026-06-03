import os
import requests
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.environ.get("RUNPOD_API_KEY")

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}"
}

query = """
query {
  podTemplate(id: "le6kbu9vmp") {
    id
    name
    env {
      key
      value
    }
  }
}
"""

res = requests.post("https://api.runpod.io/graphql", json={"query": query}, headers=headers)
print(res.json())

