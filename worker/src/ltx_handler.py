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

# Hardcoded to bypass invalid copy-paste values in RunPod Dashboard
R2_ACCESS_KEY_ID = "1f8d976c6b394e7d22685aeb24cbed20"
R2_SECRET_ACCESS_KEY = "46ab3e8811d874d39ad456a6540578afac12d14b8e1aa10203c785085559eca5"
R2_ENDPOINT_URL = "https://1a33db30740b936c38a50defea0fd609.r2.cloudflarestorage.com"
R2_BUCKET_NAME = "novascene-assets"
R2_CDN_URL = "https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev"

# Duplicate lines removed

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
    
    # 2. Upload using requests to capture exact HTTP error
    import requests
    with open(file_path, 'rb') as f:
        response = requests.put(
            presigned_url, 
            data=f, 
            headers={'Content-Type': 'video/mp4'}
        )
    
    if response.status_code != 200:
        safe_url = presigned_url.split("?")[0]
        raise Exception(f"R2 Upload failed: HTTP {response.status_code} - {response.text}\nTarget URL: {safe_url}")
    
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
        
        # LTX requires width and height to be divisible by 32
        width, height = 704, 480  # Default 16:9 safe resolution for LTX
        
        # CRITICAL FIX: Resize the image exactly to the pipeline dimensions
        # Otherwise, the model receives a mismatched conditioning latent and creates distortion
        print(f"[LTX Worker] Resizing image to {width}x{height} to match LTX latent requirements")
        image = image.resize((width, height))
        
        # Calculate frames at 24fps
        # Ensure num_frames is appropriate for LTX (e.g. 121 for 5s, up to 257 for longer)
        # We will use 24fps. duration * 24 + 1
        num_frames = int(duration * 24) + 1
        
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
