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
  myself {
    endpoints {
      id
      name
      workers {
        id
      }
    }
  }
}
"""
res = requests.post("https://api.runpod.io/graphql", json={"query": query}, headers=headers)
data = res.json().get('data', {}).get('myself', {}).get('endpoints', [])
for ep in data:
    print(f"Endpoint: {ep['name']} ({ep['id']})")

