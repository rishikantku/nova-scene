# worker/src/ltx_handler.py
import os
import time
import uuid
import boto3
import certifi
import torch
import runpod
from botocore.config import Config
from diffusers import LTXImageToVideoPipeline
from diffusers.utils import export_to_video, load_image

# Load configurations from environment variables
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "mock-key")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "mock-secret")
R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL", "http://mock-endpoint")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "novascene-media")
R2_CDN_URL = os.environ.get("R2_CDN_URL", "http://mock-public-url")

print("[LTX Worker] Initializing LTXImageToVideoPipeline...")
repo_id = "Lightricks/LTX-Video"
# bfloat16 is highly recommended for LTX-Video to manage memory while maintaining quality
pipeline = LTXImageToVideoPipeline.from_pretrained(repo_id, torch_dtype=torch.bfloat16)
pipeline = pipeline.to("cuda")
print("[LTX Worker] Pipeline loaded successfully on CUDA.")

def upload_to_r2(file_path: str, key_name: str) -> str:
    print(f"[LTX Worker] Uploading {file_path} to R2 as {key_name} via cURL bypass...")
    
    # 1. Generate presigned URL (local only, no SSL)
    s3_client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(signature_version="s3v4", s3={'addressing_style': 'path'})
    )
    
    presigned_url = s3_client.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': R2_BUCKET_NAME,
            'Key': key_name,
            'ContentType': 'video/mp4'
        },
        ExpiresIn=3600
    )
    
    # 2. Use system cURL to bypass Python's urllib3 SSL handshake issues (Force IPv4)
    import subprocess
    curl_cmd = [
        "curl", "-4", "-s", "-S", "-X", "PUT",
        "-T", file_path,
        "-H", "Content-Type: video/mp4",
        presigned_url
    ]
    
    result = subprocess.run(curl_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        safe_url = presigned_url.split("?")[0] # Hide signature in logs
        raise Exception(f"cURL upload failed: {result.stderr}\nTarget URL: {safe_url}")
    
    public_url = f"{R2_CDN_URL}/{key_name}"
    print(f"[LTX Worker] Upload complete: {public_url}")
    return public_url

def handler(job):
    """
    RunPod serverless handler for LTX-Video Generation.
    Expected job_input:
    {
      "image_url": "https://pub-....jpg",
      "prompt": "gentle waves",
      "duration": 5,
      "num_inference_steps": 50
    }
    """
    try:
        job_input = job.get("input", {})
        prompt = job_input.get("prompt", "")
        image_url = job_input.get("image_url", "")
        duration = float(job_input.get("duration", 5.0))
        num_inference_steps = int(job_input.get("num_inference_steps", 50))
        
        if not prompt or not image_url:
            return {"error": "Missing 'prompt' or 'image_url' in input"}
            
        print(f"[LTX Worker] Generating {duration}s video for prompt: \"{prompt}\"")
        start_time = time.time()
        
        # Load the base image
        print(f"[LTX Worker] Downloading base image: {image_url}")
        image = load_image(image_url)
        
        # Calculate frames at 24fps
        # Ensure num_frames is appropriate for LTX (e.g. 121 for 5s, up to 257 for longer)
        # We will use 24fps. duration * 24 + 1
        num_frames = int(duration * 24) + 1
        
        # LTX requires width and height to be divisible by 32
        width, height = 704, 480  # Default 16:9 safe resolution for LTX
        
        print(f"[LTX Worker] Starting LTX pipeline for {num_frames} frames...")
        video_frames = pipeline(
            image=image,
            prompt=prompt,
            negative_prompt="worst quality, inconsistent motion, blurry, jittery, distorted",
            width=width,
            height=height,
            num_frames=num_frames,
            num_inference_steps=num_inference_steps,
        ).frames[0]
        
        inference_time = time.time() - start_time
        print(f"[LTX Worker] Generation completed in {inference_time:.2f} seconds.")
        
        # Save temp video file locally
        temp_filename = f"ltx_{uuid.uuid4()}.mp4"
        temp_path = os.path.join("/tmp", temp_filename)
        export_to_video(video_frames, temp_path, fps=24)
        
        # Upload video to R2
        r2_key = f"scenes/{temp_filename}"
        public_url = upload_to_r2(temp_path, r2_key)
        
        # Clean up local file
        if os.path.exists(temp_path):
            os.remove(temp_path)
            
        return {"video_url": public_url}
        
    except torch.cuda.OutOfMemoryError:
        print("[LTX Worker] CUDA Out Of Memory Error encountered!")
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return {"error": "CUDA OOM error.", "error_code": "CUDA_OOM"}
    except Exception as e:
        print(f"[LTX Worker] Error during LTX generation: {str(e)}")
        return {"error": str(e)}

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
