import os
import requests
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.environ.get("RUNPOD_API_KEY")

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}"
}

# 1. Fetch current template
query = """
query {
  podTemplate(id: "gnhb1gkic9") {
    id
    name
    imageName
    dockerArgs
    volumeInGb
    isPublic
    env {
      key
      value
    }
  }
}
"""
res = requests.post("https://api.runpod.io/graphql", json={"query": query}, headers=headers)
template = res.json()["data"]["podTemplate"]

# env list
env_list = [{"key": item['key'], "value": item['value']} for item in template.get('env', [])]

# 2. Update template with 120GB disk
mutation = """
mutation SaveTemplate($input: SaveTemplateInput!) {
  saveTemplate(input: $input) {
    id
    name
    containerDiskInGb
  }
}
"""

variables = {
  "input": {
      "id": template["id"],
      "name": template["name"],
      "imageName": template.get("imageName", ""),
      "dockerArgs": template.get("dockerArgs", ""),
      "containerDiskInGb": 120,
      "volumeInGb": template.get("volumeInGb", 0),
      "isPublic": template.get("isPublic", False),
      "env": env_list
  }
}

res_update = requests.post("https://api.runpod.io/graphql", json={"query": mutation, "variables": variables}, headers=headers)
print(res_update.json())

