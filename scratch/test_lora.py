import requests
import time
import os

API_KEY = "YOUR_RUNPOD_API_KEY"
ENDPOINT_ID = "u2rpbv69v0xufv"

url = f"https://api.runpod.ai/v2/{ENDPOINT_ID}/run"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

payload = {
    "input": {
        "dataset_urls": [
            "https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev/keyframes/keyframe_56aa39af-d0b4-419a-a9c7-89af20100786.jpg",
            "https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev/keyframes/keyframe_56aa39af-d0b4-419a-a9c7-89af20100786.jpg"  # duplicating for testing
        ],
        "trigger_token": "tamatar",
        "lora_id": "test_tamatar_lora"
    }
}

print("Submitting LoRA training job...")
response = requests.post(url, headers=headers, json=payload)
print(f"Response: {response.status_code}")
data = response.json()
print(data)

job_id = data.get("id")

if job_id:
    print(f"\nJob ID: {job_id}")
    print("Polling for status...")
    status_url = f"https://api.runpod.ai/v2/{ENDPOINT_ID}/status/{job_id}"
    
    for _ in range(30):
        time.sleep(5)
        status_res = requests.get(status_url, headers=headers)
        status_data = status_res.json()
        print(f"Status: {status_data.get('status')}")
        if status_data.get("status") == "COMPLETED":
            print(f"Output: {status_data.get('output')}")
            break
        if status_data.get("status") == "FAILED":
            print(f"Error: {status_data}")
            break
