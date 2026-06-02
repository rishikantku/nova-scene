# worker/src/wan_handler.py
import os
import time
import uuid
import requests
import math
import boto3
import certifi
import torch
from PIL import Image
from botocore.config import Config
# Import Diffusers' Wan Image-to-Video pipeline class
# Note: Wan I2V pipeline loading standard syntax (WanImageToVideoPipeline)
from diffusers import WanImageToVideoPipeline
from diffusers.utils import export_to_video
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
        print("[Wan Worker] Initializing Wan 2.1 Image-to-Video pipeline...")
        print(f"[Wan Worker] Using cache directory: {CACHE_DIR}")

        # Load Wan 2.1 I2V model (480P variant — balanced quality/speed)
        model_id = "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers"

        pipe = WanImageToVideoPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16,
            cache_dir=CACHE_DIR
        )

        # Enable model CPU offloading: offloads entire components to RAM when not in use.
        # This allows lightning fast generation on 80GB VRAM GPUs (like H100 or A100)
        # because the massive 28GB Transformer fits entirely in the GPU during inference!
        pipe.enable_model_cpu_offload()
        
        # Enable VAE slicing and tiling to prevent OOM when decoding high-res video frames
        pipe.vae.enable_slicing()
        pipe.vae.enable_tiling()
        
        print("[Wan Worker] Model loaded with Full Component CPU offloading & VAE tiling enabled (80GB VRAM Optimized).")
    return pipe

def upload_to_r2(local_path: str, bucket_key: str) -> str:
    print(f"[Wan Worker] Uploading generated motion clip to R2 bucket: {R2_BUCKET_NAME} as {bucket_key}...")
    
    # Configure boto3 client for Cloudflare R2
    s3_config = Config(retries={"max_attempts": 3, "mode": "standard"})
    s3_client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=s3_config,
        verify=certifi.where()  # Fix SSL handshake failure with Cloudflare R2
    )
    
    s3_client.upload_file(local_path, R2_BUCKET_NAME, bucket_key)
    
    # Construct CDN/Public asset access URL
    url = f"{R2_CDN_URL}/{bucket_key}" if R2_CDN_URL else f"{R2_ENDPOINT_URL}/{R2_BUCKET_NAME}/{bucket_key}"
    print(f"[Wan Worker] Upload completed. CDN URL: {url}")
    return url

def download_image(image_url: str) -> Image.Image:
    print(f"[Wan Worker] Downloading keyframe image from: {image_url}")
    response = requests.get(image_url, stream=True, timeout=15)
    response.raise_for_status()
    return Image.open(response.raw).convert("RGB")

def handler(job):
    job_input = job.get("input", {})
    image_url = job_input.get("image_url")
    prompt = job_input.get("prompt")
    
    if not image_url or not prompt:
        return {"error": "Both 'image_url' and 'prompt' are required."}
        
    duration = job_input.get("duration", 5) # Default 5s clip
    num_inference_steps = job_input.get("num_inference_steps", 40)
    fps = job_input.get("fps", 16)
    
    try:
        # Load/Verify model
        pipeline = get_pipeline()
        
        # Download and resize/prepare starting keyframe image
        input_image = download_image(image_url)
        # Scale to match target resolution (e.g. 832x480 for Wan 2.1 480P model)
        input_image = input_image.resize((832, 480))
        # --- Autoregressive Chaining Trick ---
        # Instead of interpolating, we break long durations into 5-second chunks
        # and feed the last frame of the previous chunk into the next chunk!
        chunk_duration = 5
        total_chunks = max(1, math.ceil(duration / chunk_duration))
        
        all_video_frames = []
        current_input_image = input_image
        
        print(f"[Wan Worker] Starting Autoregressive Chaining for {duration}s video ({total_chunks} chunks at {fps} FPS)")
        start_time = time.time()
        
        for i in range(total_chunks):
            print(f"[Wan Worker] Generating Chunk {i+1}/{total_chunks}...")
            
            # Determine how many frames this chunk needs (last chunk might be shorter)
            remaining_duration = duration - (i * chunk_duration)
            current_duration = min(chunk_duration, remaining_duration)
            # Diffusers Wan2.1 requires num_frames - 1 to be divisible by 4.
            # E.g. for 5s at 16fps: 5*16 = 80. Nearest valid is 81.
            current_num_frames = int(current_duration * fps) + 1
            
            # Ensure divisible by 4 rule:
            while (current_num_frames - 1) % 4 != 0:
                current_num_frames += 1
            
            chunk_output_frames = pipeline(
                current_input_image,
                prompt,
                num_frames=current_num_frames,
                num_inference_steps=num_inference_steps,
                output_type="pil"
            ).frames[0]
            
            if i == 0:
                all_video_frames.extend(chunk_output_frames)
            else:
                # Drop the first frame to avoid duplicate overlapping frames
                all_video_frames.extend(chunk_output_frames[1:])
            
            # Set the very last generated frame as the starting image for the next chunk
            if i < total_chunks - 1:
                current_input_image = chunk_output_frames[-1]
                
        inference_time = time.time() - start_time
        print(f"[Wan Worker] Inference completed in {inference_time:.2f} seconds.")
        
        # Save temp video file locally
        temp_filename = f"motion_chained_{uuid.uuid4()}.mp4"
        temp_path = os.path.join("/tmp", temp_filename)
        export_to_video(all_video_frames, temp_path, fps=fps)
        
        # Upload final video clip to R2
        r2_key = f"scenes/motion_{uuid.uuid4()}.mp4"
        public_url = upload_to_r2(temp_path, r2_key)
        
        # Clean up local files
        if os.path.exists(temp_path):
            os.remove(temp_path)
            
        return {"video_url": public_url}
        
    except torch.cuda.OutOfMemoryError as oom:
        print("[Wan Worker] CUDA Out Of Memory Error encountered!")
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return {"error": "CUDA OOM error, retry on larger VRAM worker.", "error_code": "CUDA_OOM"}
    except Exception as e:
        print(f"[Wan Worker] Error during motion generation: {str(e)}")
        return {"error": str(e)}

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
