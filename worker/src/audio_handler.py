# worker/src/audio_handler.py
import os
import time
import uuid
import boto3
import certifi
import torch
import scipy.io.wavfile
from botocore.config import Config
from diffusers import AudioLDM2Pipeline
import runpod

# Load configurations from environment variables
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "mock-key")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "mock-secret")
R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL", "http://mock-endpoint")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "novascene-media")
R2_CDN_URL = os.environ.get("R2_CDN_URL", "http://mock-public-url")

print("[Audio Worker] Initializing AudioLDM2 pipeline...")
repo_id = "cvssp/audioldm2"
pipeline = AudioLDM2Pipeline.from_pretrained(repo_id, torch_dtype=torch.float16)
pipeline = pipeline.to("cuda")
print("[Audio Worker] Pipeline loaded successfully on CUDA.")

def upload_to_r2(file_path: str, key_name: str) -> str:
    print(f"[Audio Worker] Uploading {file_path} to R2 as {key_name}...")
    s3_client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(signature_version="s3v4")
    )
    
    # Use CA bundle for Cloudflare compatibility
    os.environ['REQUESTS_CA_BUNDLE'] = certifi.where()
    
    s3_client.upload_file(
        file_path, 
        R2_BUCKET_NAME, 
        key_name,
        ExtraArgs={'ContentType': 'audio/wav'}
    )
    
    public_url = f"{R2_CDN_URL}/{key_name}"
    print(f"[Audio Worker] Upload complete: {public_url}")
    return public_url

def handler(job):
    """
    RunPod serverless handler for Audio Generation.
    Expected job_input:
    {
      "prompt": "cinematic bass drop, epic",
      "duration": 15,
      "num_inference_steps": 200
    }
    """
    try:
        job_input = job.get("input", {})
        prompt = job_input.get("prompt", "")
        duration = float(job_input.get("duration", 10.0))
        num_inference_steps = int(job_input.get("num_inference_steps", 200))
        
        if not prompt:
            return {"error": "Missing 'prompt' in input"}
            
        print(f"[Audio Worker] Generating {duration}s audio for prompt: \"{prompt}\"")
        start_time = time.time()
        
        audio = pipeline(
            prompt,
            num_inference_steps=num_inference_steps,
            audio_length_in_s=duration
        ).audios[0]
        
        inference_time = time.time() - start_time
        print(f"[Audio Worker] Generation completed in {inference_time:.2f} seconds.")
        
        # Save temp wav file locally
        temp_filename = f"audio_{uuid.uuid4()}.wav"
        temp_path = os.path.join("/tmp", temp_filename)
        scipy.io.wavfile.write(temp_path, rate=16000, data=audio)
        
        # Upload audio clip to R2
        r2_key = f"scenes/{temp_filename}"
        public_url = upload_to_r2(temp_path, r2_key)
        
        # Clean up local file
        if os.path.exists(temp_path):
            os.remove(temp_path)
            
        return {"audio_url": public_url}
        
    except torch.cuda.OutOfMemoryError:
        print("[Audio Worker] CUDA Out Of Memory Error encountered!")
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return {"error": "CUDA OOM error.", "error_code": "CUDA_OOM"}
    except Exception as e:
        print(f"[Audio Worker] Error during audio generation: {str(e)}")
        return {"error": str(e)}

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
