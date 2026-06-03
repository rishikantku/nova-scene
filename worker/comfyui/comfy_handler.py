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
        log_content = "Log file not found."
        if os.path.exists("/workspace/comfy.log"):
            with open("/workspace/comfy.log", "r") as f:
                log_content = f.read()[-2000:] # Get last 2000 chars
        raise Exception(f"Failed to connect to ComfyUI: {e}\nComfyUI Logs:\n{log_content}")

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

WORKFLOW_PATH = "/workspace/wan_comfy_workflow.json"

def handler(job):
    job_input = job.get("input", {})
    image_url = job_input.get("image_url")
    prompt = job_input.get("prompt", "cinematic motion, smooth animation, high quality video")
    
    if not image_url:
        return {"error": "Missing 'image_url' in input"}
        
    try:
        # Load the baked-in workflow template
        with open(WORKFLOW_PATH, "r") as f:
            workflow_json = json.load(f)
        
        # Download the reference image to ComfyUI's input directory
        print(f"[ComfyUI Worker] Downloading input image: {image_url}")
        filename = download_image_for_comfy(image_url)
        
        # Inject prompt and image filename into the correct nodes
        for node_id, node in workflow_json.items():
            class_type = node.get("class_type", "")
            
            if class_type == "LoadImage":
                node["inputs"]["image"] = filename
                print(f"[ComfyUI Worker] Injected image '{filename}' into LoadImage node {node_id}")
                
            elif class_type == "WanVideoTextEncode":
                node["inputs"]["positive_prompt"] = prompt
                print(f"[ComfyUI Worker] Injected prompt into WanVideoTextEncode node {node_id}")

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
            
        # Parse outputs
        outputs = history[prompt_id].get("outputs", {})
        
        # Find the saved file - VHS_VideoCombine outputs under 'gifs' key
        saved_files = []
        output_dir = "/workspace/ComfyUI/output"
        
        for node_id, node_output in outputs.items():
            if "gifs" in node_output:
                for file_info in node_output["gifs"]:
                    saved_files.append(file_info["filename"])
            elif "images" in node_output:
                for file_info in node_output["images"]:
                    saved_files.append(file_info["filename"])
                    
        if not saved_files:
            return {"error": "Workflow completed but no output files were detected.", "outputs": outputs}
            
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
                
                # Dump schema for each node type used in our workflow
                node_types = ["WanVideoModelLoader", "WanVideoTextEncode", "WanVideoImageToVideoEncode", 
                              "WanVideoSampler", "WanVideoDecode", "VHS_VideoCombine", "LoadImage"]
                for nt in node_types:
                    try:
                        with urllib.request.urlopen(f"{COMFYUI_SERVER}/object_info/{nt}") as r:
                            info = json.loads(r.read())
                            if nt in info:
                                inputs = info[nt].get("input", {})
                                req = list(inputs.get("required", {}).keys())
                                opt = list(inputs.get("optional", {}).keys())
                                print(f"[Schema] {nt}: required={req}, optional={opt}")
                    except Exception as e:
                        print(f"[Schema] {nt}: FAILED to query ({e})")
                
                break
        except Exception:
            time.sleep(1)
    else:
        log_content = "Log file not found."
        if os.path.exists("/workspace/comfy.log"):
            with open("/workspace/comfy.log", "r") as f:
                log_content = f.read()[-2000:]
        print(f"[ComfyUI Worker] WARNING: ComfyUI server failed to start within 60 seconds.\nComfyUI Logs:\n{log_content}")

    print("[ComfyUI Worker] Starting RunPod Serverless Handler...")
    runpod.serverless.start({"handler": handler})
