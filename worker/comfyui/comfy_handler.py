import os
import time
import json
import uuid
import urllib.request
import urllib.error
import urllib.parse
import runpod
import boto3
from botocore.config import Config
import certifi

# Cloudflare R2 Config
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "1f8d976c6b394e7d22685aeb24cbed20")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "46ab3e8811d874d39ad456a6540578afac12d14b8e1aa10203c785085559eca5")
R2_ENDPOINT_URL = "https://1a33db30740b936c38a50defea0fd609.r2.cloudflarestorage.com"
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "novascene-assets")
R2_CDN_URL = "https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev"

COMFYUI_SERVER = "http://127.0.0.1:8188"

def upload_to_r2(local_path: str, bucket_key: str) -> str:
    print(f"[ComfyUI Worker] Uploading {local_path} to R2 as {bucket_key}...")
    s3_config = Config(retries={"max_attempts": 3, "mode": "standard"})
    s3_client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=s3_config,
        verify=certifi.where()
    )
    s3_client.upload_file(local_path, R2_BUCKET_NAME, bucket_key)
    return f"{R2_CDN_URL}/{bucket_key}"

def queue_prompt(prompt_workflow):
    p = {"prompt": prompt_workflow}
    data = json.dumps(p).encode('utf-8')
    req = urllib.request.Request(f"{COMFYUI_SERVER}/prompt", data=data, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read())
    except urllib.error.URLError as e:
        raise Exception(f"Failed to connect to ComfyUI: {e}")

def get_history(prompt_id):
    try:
        with urllib.request.urlopen(f"{COMFYUI_SERVER}/history/{prompt_id}") as response:
            return json.loads(response.read())
    except urllib.error.URLError as e:
        return {}

def download_image_for_comfy(image_url: str) -> str:
    """Download the reference image to ComfyUI's input directory."""
    import requests
    input_dir = "/workspace/ComfyUI/input" # Typical path in runpod comfy containers
    os.makedirs(input_dir, exist_ok=True)
    filename = f"input_{uuid.uuid4().hex}.jpg"
    local_path = os.path.join(input_dir, filename)
    
    res = requests.get(image_url, stream=True)
    res.raise_for_status()
    with open(local_path, 'wb') as f:
        for chunk in res.iter_content(chunk_size=8192):
            f.write(chunk)
            
    return filename # ComfyUI LoadImage node expects just the filename if it's in /input

def handler(job):
    job_input = job.get("input", {})
    workflow_json = job_input.get("workflow_json")
    image_url = job_input.get("image_url")
    
    if not workflow_json:
        return {"error": "Missing 'workflow_json' in input"}
        
    try:
        # If there's an image, we download it and inject the filename into the workflow
        # The backend should include a marker like "INJECT_IMAGE_FILENAME" in the workflow JSON
        if image_url:
            print(f"[ComfyUI Worker] Downloading input image: {image_url}")
            filename = download_image_for_comfy(image_url)
            
            # Find the LoadImage node and replace its image field
            for node_id, node in workflow_json.items():
                if node.get("class_type") == "LoadImage":
                    # Assume we inject into the first LoadImage node found
                    node["inputs"]["image"] = filename
                    break

        print("[ComfyUI Worker] Queuing workflow to ComfyUI...")
        queue_response = queue_prompt(workflow_json)
        prompt_id = queue_response.get("prompt_id")
        
        if not prompt_id:
            return {"error": "Failed to queue prompt in ComfyUI", "details": queue_response}
            
        print(f"[ComfyUI Worker] Prompt queued. ID: {prompt_id}")
        
        # Poll for completion
        while True:
            history = get_history(prompt_id)
            if prompt_id in history:
                break
            time.sleep(2)
            
        # Parse outputs (assuming the workflow ends with a SaveVideo or SaveAnimatedWEBP node)
        outputs = history[prompt_id].get("outputs", {})
        
        # Find the saved file
        saved_files = []
        output_dir = "/workspace/ComfyUI/output"
        
        for node_id, node_output in outputs.items():
            if "gifs" in node_output: # typical for AnimateDiff/Video nodes
                for file_info in node_output["gifs"]:
                    saved_files.append(file_info["filename"])
            elif "images" in node_output: # Sometimes videos are saved under 'images' array depending on custom node
                for file_info in node_output["images"]:
                    saved_files.append(file_info["filename"])
                    
        if not saved_files:
            return {"error": "Workflow completed but no output files were detected."}
            
        # Upload the first output file to R2
        output_filename = saved_files[0]
        local_output_path = os.path.join(output_dir, output_filename)
        
        if not os.path.exists(local_output_path):
            return {"error": f"Output file {local_output_path} not found on disk."}
            
        r2_key = f"scenes/comfy_{uuid.uuid4().hex}.mp4"
        public_url = upload_to_r2(local_output_path, r2_key)
        
        # Cleanup
        os.remove(local_output_path)
        
        return {"video_url": public_url}
        
    except Exception as e:
        print(f"[ComfyUI Worker] Error: {str(e)}")
        return {"error": str(e)}

if __name__ == "__main__":
    # Ensure ComfyUI is running in the background before starting the RunPod serverless handler
    print("[ComfyUI Worker] Waiting for ComfyUI server to start...")
    max_retries = 60
    for i in range(max_retries):
        try:
            with urllib.request.urlopen(f"{COMFYUI_SERVER}/system_stats") as response:
                print("[ComfyUI Worker] ComfyUI server is up and running!")
                break
        except Exception:
            time.sleep(1)
    else:
        print("[ComfyUI Worker] WARNING: ComfyUI server failed to start within 60 seconds.")

    print("[ComfyUI Worker] Starting RunPod Serverless Handler...")
    runpod.serverless.start({"handler": handler})
