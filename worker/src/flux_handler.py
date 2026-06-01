# worker/src/flux_handler.py
import os
import time
import uuid
import boto3
import torch
from botocore.config import Config
from diffusers import FluxPipeline
import runpod

# Load configurations from environment variables
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "mock-key")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "mock-secret")
R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL", "http://mock-endpoint")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "novascene-assets")
R2_CDN_URL = os.environ.get("R2_CDN_URL", "https://cdn.novascene.ai")

# Cache models on RunPod's persistent volume if available
CACHE_DIR = os.environ.get("HF_HOME", "/runpod-volume/huggingface")

# Global pipeline reference for hot containers
pipe = None

def get_pipeline():
    global pipe
    if pipe is None:
        print("[Flux Worker] Initializing Flux 1.2.1 pipeline...")
        print(f"[Flux Worker] Using cache directory: {CACHE_DIR}")
        
        hf_token = os.environ.get("HF_TOKEN")
        if hf_token:
            print(f"[Flux Worker] HF_TOKEN is set. Length: {len(hf_token)}. Starts with: {hf_token[:8]}")
        else:
            print("[Flux Worker] WARNING: HF_TOKEN environment variable is not set!")
            
        # Load Flux Schnell (speed-optimized) or Dev
        model_id = "black-forest-labs/FLUX.1-schnell"
        
        pipe = FluxPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16,
            cache_dir=CACHE_DIR,
            token=hf_token
        )
        
        # Enable CPU offloading to avoid CUDA OOM on 24GB GPUs.
        # FLUX.1-schnell weights (~22.6GB bfloat16) exceed 24GB when fully
        # resident on GPU. Offloading swaps layers to RAM when not in use.
        pipe.enable_model_cpu_offload()
        print("[Flux Worker] Model loaded with CPU offloading enabled (24GB VRAM compatible).")
    return pipe

def upload_to_r2(local_path: str, bucket_key: str) -> str:
    print(f"[Flux Worker] Uploading generated keyframe to R2 bucket: {R2_BUCKET_NAME} as {bucket_key}...")
    
    # Configure boto3 client for Cloudflare R2
    s3_config = Config(retries={"max_attempts": 3, "mode": "standard"})
    s3_client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=s3_config
    )
    
    s3_client.upload_file(local_path, R2_BUCKET_NAME, bucket_key)
    
    # Construct CDN/Public asset access URL
    url = f"{R2_CDN_URL}/{bucket_key}" if R2_CDN_URL else f"{R2_ENDPOINT_URL}/{R2_BUCKET_NAME}/{bucket_key}"
    print(f"[Flux Worker] Upload completed. CDN URL: {url}")
    return url

def handler(job):
    job_input = job.get("input", {})
    prompt = job_input.get("prompt")
    
    if not prompt:
        return {"error": "Prompt input is required."}
        
    width = job_input.get("width", 1024)
    height = job_input.get("height", 576)
    num_inference_steps = job_input.get("num_inference_steps", 4) # Schnell requires fewer steps (4-8)
    guidance_scale = job_input.get("guidance_scale", 0.0) # Schnell ignores guidance scale

    try:
        # Load and reuse the pipeline
        pipeline = get_pipeline()
        
        print(f"[Flux Worker] Running inference for prompt: \"{prompt}\"")
        start_time = time.time()
        
        # Run image generation
        image = pipeline(
            prompt,
            width=width,
            height=height,
            guidance_scale=guidance_scale,
            num_inference_steps=num_inference_steps,
            max_sequence_length=256
        ).images[0]
        
        inference_time = time.time() - start_time
        print(f"[Flux Worker] Inference completed in {inference_time:.2f} seconds.")
        
        # Save temp image locally
        temp_filename = f"keyframe_{uuid.uuid4()}.jpg"
        temp_path = os.path.join("/tmp", temp_filename)
        image.save(temp_path, quality=95)
        
        # Upload keyframe image to R2
        r2_key = f"keyframes/{temp_filename}"
        public_url = upload_to_r2(temp_path, r2_key)
        
        # Clean up local temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)
            
        return {"image_url": public_url}
        
    except torch.cuda.OutOfMemoryError as oom:
        print("[Flux Worker] CUDA Out Of Memory Error encountered!")
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return {"error": "CUDA OOM error, retry on larger VRAM worker.", "error_code": "CUDA_OOM"}
    except Exception as e:
        print(f"[Flux Worker] Error during image generation: {str(e)}")
        return {"error": str(e)}

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
