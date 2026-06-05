import os
import uuid
import json
import subprocess
import shutil
import runpod
import boto3
import requests
import certifi
from botocore.config import Config

# Cloudflare R2 Config
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "1f8d976c6b394e7d22685aeb24cbed20")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "46ab3e8811d874d39ad456a6540578afac12d14b8e1aa10203c785085559eca5")
R2_ENDPOINT_URL = "https://1a33db30740b936c38a50defea0fd609.r2.cloudflarestorage.com"
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "novascene-assets")
R2_CDN_URL = "https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev"

def upload_to_r2(local_path: str, bucket_key: str) -> str:
    print(f"[Trainer] Uploading {local_path} to R2 as {bucket_key}...")
    
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
            'Key': bucket_key,
            'ContentType': 'application/octet-stream'
        },
        ExpiresIn=3600
    )
    
    with open(local_path, 'rb') as f:
        response = requests.put(
            presigned_url, 
            data=f, 
            headers={'Content-Type': 'application/octet-stream'}
        )
    
    if response.status_code != 200:
        raise Exception(f"R2 Upload failed: HTTP {response.status_code} - {response.text}")
    
    public_url = f"{R2_CDN_URL}/{bucket_key}"
    print(f"[Trainer] Upload complete: {public_url}")
    return public_url

def try_import_cv2():
    """Try to import cv2, return None if not available."""
    try:
        import cv2
        return cv2
    except ImportError:
        print("[Trainer] WARNING: cv2 not available, skipping character sheet splitting")
        return None

def handler(job):
    job_input = job.get("input", {})
    dataset_urls = job_input.get("dataset_urls", [])
    trigger_token = job_input.get("trigger_token", "ohwx")
    lora_id = job_input.get("lora_id", str(uuid.uuid4()))
    
    if not dataset_urls:
        return {"error": "Missing 'dataset_urls'"}
        
    workspace_dir = f"/workspace/training/{lora_id}"
    img_dir = os.path.join(workspace_dir, "img")
    out_dir = os.path.join(workspace_dir, "output")
    log_dir = os.path.join(workspace_dir, "log")
    os.makedirs(img_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)
    
    try:
        print(f"[Trainer] Downloading {len(dataset_urls)} images for LoRA {lora_id}...")
        
        # 1. Download Dataset
        # Kohya expects folders in format: {repeats}_{trigger_token}
        concept_dir = os.path.join(img_dir, f"10_{trigger_token}")
        os.makedirs(concept_dir, exist_ok=True)
        
        cv2 = try_import_cv2()
        
        for idx, url in enumerate(dataset_urls):
            res = requests.get(url, stream=True)
            res.raise_for_status()
            ext = url.split('.')[-1].split('?')[0]
            if ext not in ['jpg', 'png', 'jpeg']:
                ext = 'jpg'
            file_path = os.path.join(concept_dir, f"{idx}.{ext}")
            with open(file_path, 'wb') as f:
                for chunk in res.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            # Post-process: Auto-crop character sheets if cv2 available
            if cv2 is not None:
                img = cv2.imread(file_path)
                if img is not None:
                    h, w = img.shape[:2]
                    if w > h * 1.5:  # Wide image (character sheet)
                        print(f"[Trainer] Image {idx} is a character sheet ({w}x{h}). Splitting into 3...")
                        piece_w = w // 3
                        for i in range(3):
                            crop = img[:, i*piece_w:(i+1)*piece_w]
                            crop_path = os.path.join(concept_dir, f"{idx}_{i}.{ext}")
                            cv2.imwrite(crop_path, crop)
                            
                            # Create caption for each crop
                            crop_txt_path = os.path.join(concept_dir, f"{idx}_{i}.txt")
                            with open(crop_txt_path, 'w') as f:
                                f.write(f"{trigger_token}, cinematic, highly detailed")
                        
                        # Clean up the original sheet
                        os.remove(file_path)
                    else:
                        # Regular image - create caption
                        txt_path = os.path.join(concept_dir, f"{idx}.txt")
                        with open(txt_path, 'w') as f:
                            f.write(f"{trigger_token}, cinematic, highly detailed")
                else:
                    txt_path = os.path.join(concept_dir, f"{idx}.txt")
                    with open(txt_path, 'w') as f:
                        f.write(f"{trigger_token}, cinematic, highly detailed")
            else:
                # No cv2 - just write caption
                txt_path = os.path.join(concept_dir, f"{idx}.txt")
                with open(txt_path, 'w') as f:
                    f.write(f"{trigger_token}, cinematic, highly detailed")
                
        num_images = len([f for f in os.listdir(concept_dir) if f.endswith(('.jpg', '.png', '.jpeg'))])
        print(f"[Trainer] Dataset prepared: {num_images} images at {concept_dir}")
        print(f"[Trainer] Dataset files: {os.listdir(concept_dir)}")
        
        # 2. Run Training
        output_name = lora_id
        cmd = [
            "accelerate", "launch",
            "--num_cpu_threads_per_process=2",
            "/workspace/sd-scripts/sdxl_train_network.py",
            "--pretrained_model_name_or_path", "stabilityai/stable-diffusion-xl-base-1.0",
            "--train_data_dir", img_dir,
            "--output_dir", out_dir,
            "--output_name", output_name,
            "--logging_dir", log_dir,
            "--resolution", "1024,1024",
            "--train_batch_size", "1",
            "--learning_rate", "1e-4",
            "--lr_scheduler", "cosine",
            "--lr_warmup_steps", "0",
            "--max_train_epochs", "3",
            "--network_dim", "16",
            "--network_alpha", "8",
            "--network_module", "networks.lora",
            "--save_model_as", "safetensors",
            "--mixed_precision", "fp16",
            "--save_precision", "fp16",
            "--cache_latents",
            "--gradient_checkpointing",
            "--optimizer_type", "AdamW",
            "--max_data_loader_n_workers", "2",
            "--bucket_no_upscale",
            "--enable_bucket",
            "--min_bucket_reso", "256",
            "--max_bucket_reso", "2048",
            "--xformers",
        ]
        
        print(f"[Trainer] Launching training with {num_images} images...")
        print(f"[Trainer] Full command: {' '.join(cmd)}")
        
        # Use Popen to stream output in real-time for better debugging
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # Merge stderr into stdout
            text=True,
            bufsize=1  # Line buffered
        )
        
        output_lines = []
        for line in process.stdout:
            line = line.rstrip()
            print(f"[Training] {line}")
            output_lines.append(line)
        
        process.wait(timeout=3600)
        
        if process.returncode != 0:
            full_output = "\n".join(output_lines[-50:])  # Last 50 lines
            print(f"[Trainer] Training FAILED (exit code {process.returncode})")
            print(f"[Trainer] Last 50 lines of output:\n{full_output}")
            raise Exception(f"Training failed with exit code {process.returncode}. Last output: {full_output[-1000:]}")
        
        print(f"[Trainer] Training completed successfully!")
        
        # 3. Find the output safetensors file
        output_file = os.path.join(out_dir, f"{output_name}.safetensors")
        if not os.path.exists(output_file):
            # Try to find any safetensors file in the output dir
            for f in os.listdir(out_dir):
                if f.endswith('.safetensors'):
                    output_file = os.path.join(out_dir, f)
                    break
        
        if not os.path.exists(output_file):
            raise Exception(f"No .safetensors file found in {out_dir}. Contents: {os.listdir(out_dir)}")
        
        file_size = os.path.getsize(output_file)
        print(f"[Trainer] LoRA file: {output_file} ({file_size / 1024 / 1024:.1f} MB)")
        
        # 4. Upload LoRA to R2
        r2_key = f"loras/{lora_id}.safetensors"
        public_url = upload_to_r2(output_file, r2_key)
        
        # 5. Cleanup
        shutil.rmtree(workspace_dir, ignore_errors=True)
        
        return {"lora_url": public_url, "lora_id": lora_id}
        
    except subprocess.TimeoutExpired:
        print("[Trainer] Training timed out after 1 hour!")
        shutil.rmtree(workspace_dir, ignore_errors=True)
        return {"error": "Training timed out after 1 hour"}
    except Exception as e:
        print(f"[Trainer] Error: {str(e)}")
        shutil.rmtree(workspace_dir, ignore_errors=True)
        return {"error": str(e)}

if __name__ == "__main__":
    print("[Trainer Worker] Starting RunPod Serverless Handler...")
    runpod.serverless.start({"handler": handler})
