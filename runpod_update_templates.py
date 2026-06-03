import os
import requests
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.environ.get("RUNPOD_API_KEY")

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}"
}

TEMPLATE_IDS = ["le6kbu9vmp", "gnhb1gkic9"]

for t_id in TEMPLATE_IDS:
    # 1. Fetch current template
    query = f"""
    query {{
      podTemplate(id: "{t_id}") {{
        id
        name
        imageName
        dockerArgs
        containerDiskInGb
        volumeInGb
        isPublic
        env {{
          key
          value
        }}
      }}
    }}
    """
    res = requests.post("https://api.runpod.io/graphql", json={"query": query}, headers=headers)
    template = res.json()["data"]["podTemplate"]
    
    # 2. Merge new env vars
    new_env = {
        "R2_ACCESS_KEY_ID": os.environ.get("R2_ACCESS_KEY_ID"),
        "R2_SECRET_ACCESS_KEY": os.environ.get("R2_SECRET_ACCESS_KEY"),
        "R2_ENDPOINT_URL": os.environ.get("R2_ENDPOINT_URL")
    }
    
    current_env = {item['key']: item['value'] for item in template.get('env', []) if item['key'] not in new_env}
    current_env.update(new_env)
    
    env_list = [{"key": k, "value": v} for k, v in current_env.items()]
    
    # 3. Update template
    mutation = """
    mutation SaveTemplate($input: SaveTemplateInput!) {
      saveTemplate(input: $input) {
        id
        name
      }
    }
    """
    
    # The input for SaveTemplate Input needs to have exactly what we got
    variables = {
      "input": {
          "id": template["id"],
          "name": template["name"],
          "imageName": template.get("imageName", ""),
          "dockerArgs": template.get("dockerArgs", ""),
          "containerDiskInGb": template.get("containerDiskInGb", 0),
          "volumeInGb": template.get("volumeInGb", 0),
          "isPublic": template.get("isPublic", False),
          "env": env_list
      }
    }
    
    res_update = requests.post("https://api.runpod.io/graphql", json={"query": mutation, "variables": variables}, headers=headers)
    print(f"Update response for {t_id}:", res_update.json())

