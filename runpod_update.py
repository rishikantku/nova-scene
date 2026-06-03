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
    podTemplates {
      id
      name
      imageName
      dockerArgs
      env {
        key
        value
      }
    }
  }
}
"""

res = requests.post("https://api.runpod.io/graphql", json={"query": query}, headers=headers)
templates = res.json()["data"]["myself"]["podTemplates"]

for t in templates:
    if "nova-scene" in t["name"].lower():
        print(f"Updating template: {t['name']} (ID: {t['id']})")
        
        new_env = {
            "R2_ACCESS_KEY_ID": os.environ.get("R2_ACCESS_KEY_ID"),
            "R2_SECRET_ACCESS_KEY": os.environ.get("R2_SECRET_ACCESS_KEY"),
            "R2_ENDPOINT_URL": os.environ.get("R2_ENDPOINT_URL")
        }
        
        current_env = {item['key']: item['value'] for item in t.get('env', []) if item['key'] not in new_env}
        current_env.update(new_env)
        
        env_list = [{"key": k, "value": v} for k, v in current_env.items()]
        
        mutation = """
        mutation UpdateTemplate($id: String!, $env: [TemplateEnvInput]) {
          saveTemplate(input: {
            id: $id,
            env: $env
          }) {
            id
            name
          }
        }
        """
        
        variables = {
          "id": t["id"],
          "env": env_list
        }
        
        res_update = requests.post("https://api.runpod.io/graphql", json={"query": mutation, "variables": variables}, headers=headers)
        print("Update response:", res_update.json())

