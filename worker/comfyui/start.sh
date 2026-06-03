#!/bin/bash
set -e

COMFY=/workspace/ComfyUI
VOLUME=/runpod-volume
VOLUME_MODELS=$VOLUME/comfyui-models

echo "============================================="
echo "[Startup] Checking for Network Volume..."
echo "============================================="

if [ -d "$VOLUME" ]; then
    echo "[OK] Network Volume mounted at $VOLUME"
    
    # Create persistent model directories on the volume
    mkdir -p "$VOLUME_MODELS/diffusion_models"
    mkdir -p "$VOLUME_MODELS/clip"
    mkdir -p "$VOLUME_MODELS/vae"
    mkdir -p "$VOLUME_MODELS/clip_vision"
    
    # Symlink ComfyUI model dirs to the persistent volume
    for dir in diffusion_models clip vae clip_vision; do
        rm -rf "$COMFY/models/$dir"
        ln -sf "$VOLUME_MODELS/$dir" "$COMFY/models/$dir"
        echo "[Symlink] $COMFY/models/$dir -> $VOLUME_MODELS/$dir"
    done
else
    echo "[WARNING] No Network Volume found at $VOLUME!"
    echo "[WARNING] Models will be downloaded to ephemeral storage and LOST on restart."
    VOLUME_MODELS="$COMFY/models"
fi

echo ""
echo "============================================="
echo "[Startup] Diagnosing model files..."
echo "============================================="

for dir in diffusion_models clip vae clip_vision; do
    echo ""
    echo "--- $dir ---"
    ls -lh "$COMFY/models/$dir/" 2>/dev/null || echo "(empty)"
done

echo ""
echo "============================================="
echo "[Startup] Checking/downloading required models..."
echo "============================================="

python3 << 'PYEOF'
import os
from huggingface_hub import hf_hub_download

VOLUME = "/runpod-volume/comfyui-models"
if not os.path.isdir("/runpod-volume"):
    VOLUME = "/workspace/ComfyUI/models"

REQUIRED_MODELS = [
    {
        "local_dir": f"{VOLUME}/clip",
        "filename": "umt5-xxl-enc-bf16.safetensors",
        "repo_id": "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "subfolder": "split_files/text_encoders",
    },
    {
        "local_dir": f"{VOLUME}/diffusion_models",
        "filename": "wan2.1_i2v_720p_14B_bf16.safetensors",
        "repo_id": "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "subfolder": "split_files/diffusion_models",
    },
    {
        "local_dir": f"{VOLUME}/vae",
        "filename": "wan_2.1_vae.safetensors",
        "repo_id": "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "subfolder": "split_files/vae",
    },
    {
        "local_dir": f"{VOLUME}/clip_vision",
        "filename": "clip_vision_h.safetensors",
        "repo_id": "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "subfolder": "split_files/clip_vision",
    },
]

for model in REQUIRED_MODELS:
    path = os.path.join(model["local_dir"], model["filename"])
    if os.path.exists(path):
        size_gb = os.path.getsize(path) / (1024**3)
        print(f"[OK] {model['filename']} ({size_gb:.1f} GB)")
    else:
        print(f"[MISSING] {model['filename']} - downloading from {model['repo_id']}...")
        os.makedirs(model["local_dir"], exist_ok=True)
        hf_hub_download(
            repo_id=model["repo_id"],
            filename=model["filename"],
            subfolder=model["subfolder"],
            local_dir=model["local_dir"],
            local_dir_use_symlinks=False,
        )
        print(f"[DOWNLOADED] {model['filename']}")

print("")
print("[Startup] All required models are present!")
PYEOF

echo ""
echo "============================================="
echo "[Startup] Starting ComfyUI server..."
echo "============================================="

cd /workspace/ComfyUI
python main.py --listen 127.0.0.1 --port 8188 > /workspace/comfy.log 2>&1 &
sleep 10

cd /workspace
python comfy_handler.py
