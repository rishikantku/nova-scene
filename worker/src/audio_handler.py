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

# Hardcoded to bypass invalid copy-paste values in RunPod Dashboard
R2_ACCESS_KEY_ID = "1f8d976c6b394e7d22685aeb24cbed20"
R2_SECRET_ACCESS_KEY = "46ab3e8811d874d39ad456a6540578afac12d14b8e1aa10203c785085559eca5"
R2_ENDPOINT_URL = "https://1a33db30740b936c38a50defea0fd609.r2.cloudflarestorage.com"
R2_BUCKET_NAME = "novascene-assets"
R2_CDN_URL = "https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev"

# Duplicate lines removed

print("[Audio Worker] Initializing AudioLDM2 pipeline...")
repo_id = "cvssp/audioldm2"
pipeline = AudioLDM2Pipeline.from_pretrained(repo_id, torch_dtype=torch.float16)
pipeline = pipeline.to("cuda")
print("[Audio Worker] Pipeline loaded successfully on CUDA.")

def upload_to_r2(file_path: str, key_name: str) -> str:
    print(f"[Audio Worker] Uploading {file_path} to R2 as {key_name} via cURL bypass...")
    
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
            'ContentType': 'audio/wav'
        },
        ExpiresIn=3600
    )
    
    # 2. Upload using requests to capture exact HTTP error
    import requests
    with open(file_path, 'rb') as f:
        response = requests.put(
            presigned_url, 
            data=f, 
            headers={'Content-Type': 'audio/wav'}
        )
    
    if response.status_code != 200:
        safe_url = presigned_url.split("?")[0]
        raise Exception(f"R2 Upload failed: HTTP {response.status_code} - {response.text}\nTarget URL: {safe_url}")
    
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
