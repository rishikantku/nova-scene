#!/bin/bash

COMFY=/workspace/ComfyUI
VOLUME=/runpod-volume
VOLUME_MODELS=$VOLUME/comfyui-models

echo "============================================="
echo "[Startup] Checking for Network Volume..."
echo "============================================="

if [ -d "$VOLUME" ]; then
    echo "[OK] Network Volume mounted at $VOLUME"
    
    mkdir -p "$VOLUME_MODELS/diffusion_models"
    mkdir -p "$VOLUME_MODELS/text_encoders"
    mkdir -p "$VOLUME_MODELS/vae"
    mkdir -p "$VOLUME_MODELS/clip_vision"
    
    for dir in diffusion_models text_encoders vae clip_vision; do
        rm -rf "$COMFY/models/$dir"
        ln -sf "$VOLUME_MODELS/$dir" "$COMFY/models/$dir"
        echo "[Symlink] $COMFY/models/$dir -> $VOLUME_MODELS/$dir"
    done
else
    echo "[WARNING] No Network Volume at $VOLUME. Models will be ephemeral."
    VOLUME_MODELS="$COMFY/models"
fi

echo ""
echo "============================================="
echo "[Startup] Checking/downloading models..."
echo "============================================="

python3 -c "
import os, sys, shutil

try:
    from huggingface_hub import hf_hub_download
except ImportError:
    print('[WARNING] huggingface_hub not installed, skipping model download')
    sys.exit(0)

VOLUME = '/runpod-volume/comfyui-models'
if not os.path.isdir('/runpod-volume'):
    VOLUME = '/workspace/ComfyUI/models'

REQUIRED_MODELS = [
    {
        'target_dir': f'{VOLUME}/text_encoders',
        'target_name': 'umt5-xxl-enc-bf16.safetensors',
        'repo_id': 'Comfy-Org/Wan_2.1_ComfyUI_repackaged',
        'hf_path': 'split_files/text_encoders/umt5-xxl-enc-bf16.safetensors',
    },
    {
        'target_dir': f'{VOLUME}/diffusion_models',
        'target_name': 'wan2.1_i2v_720p_14B_bf16.safetensors',
        'repo_id': 'Comfy-Org/Wan_2.1_ComfyUI_repackaged',
        'hf_path': 'split_files/diffusion_models/wan2.1_i2v_720p_14B_bf16.safetensors',
    },
    {
        'target_dir': f'{VOLUME}/vae',
        'target_name': 'wan_2.1_vae.safetensors',
        'repo_id': 'Comfy-Org/Wan_2.1_ComfyUI_repackaged',
        'hf_path': 'split_files/vae/wan_2.1_vae.safetensors',
    },
    {
        'target_dir': f'{VOLUME}/clip_vision',
        'target_name': 'clip_vision_h.safetensors',
        'repo_id': 'Comfy-Org/Wan_2.1_ComfyUI_repackaged',
        'hf_path': 'split_files/clip_vision/clip_vision_h.safetensors',
    },
]

for model in REQUIRED_MODELS:
    target_path = os.path.join(model['target_dir'], model['target_name'])
    if os.path.exists(target_path):
        size_gb = os.path.getsize(target_path) / (1024**3)
        print(f\"[OK] {model['target_name']} ({size_gb:.1f} GB)\")
    else:
        print(f\"[MISSING] {model['target_name']} - downloading...\")
        try:
            os.makedirs(model['target_dir'], exist_ok=True)
            cached = hf_hub_download(
                repo_id=model['repo_id'],
                filename=model['hf_path'],
            )
            shutil.copy2(cached, target_path)
            size_gb = os.path.getsize(target_path) / (1024**3)
            print(f\"[DOWNLOADED] {model['target_name']} ({size_gb:.1f} GB)\")
        except Exception as e:
            print(f\"[ERROR] Failed to download {model['target_name']}: {e}\")

# List what's actually in each directory
for d in ['text_encoders', 'diffusion_models', 'vae', 'clip_vision']:
    full = os.path.join(VOLUME, d)
    files = os.listdir(full) if os.path.isdir(full) else []
    print(f\"[DIR] {d}: {files}\")

print('[Startup] Model check complete.')
"

echo ""
echo "============================================="
echo "[Startup] Starting ComfyUI server..."
echo "============================================="

cd /workspace/ComfyUI
python main.py --listen 127.0.0.1 --port 8188 > /workspace/comfy.log 2>&1 &

echo "[Startup] Waiting for ComfyUI to boot..."
sleep 15

cd /workspace
exec python comfy_handler.py
