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

    # Clean up old nested directories from previous hf_hub_download attempts
    for dir in diffusion_models text_encoders vae clip_vision; do
        if [ -d "$VOLUME_MODELS/$dir/split_files" ]; then
            echo "[Cleanup] Removing old nested $dir/split_files/"
            rm -rf "$VOLUME_MODELS/$dir/split_files"
        fi
    done
else
    echo "[WARNING] No Network Volume at $VOLUME. Models will be ephemeral."
    VOLUME_MODELS="$COMFY/models"
    mkdir -p "$VOLUME_MODELS/diffusion_models"
    mkdir -p "$VOLUME_MODELS/text_encoders"
    mkdir -p "$VOLUME_MODELS/vae"
    mkdir -p "$VOLUME_MODELS/clip_vision"
fi

echo ""
echo "============================================="
echo "[Startup] Checking/downloading models..."
echo "============================================="

HF_BASE="https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main"

download_model() {
    local target_path="$1"
    local hf_subpath="$2"
    local filename=$(basename "$target_path")
    
    if [ -f "$target_path" ]; then
        local size=$(du -h "$target_path" | cut -f1)
        echo "[OK] $filename ($size)"
    else
        echo "[MISSING] $filename - downloading with wget..."
        wget --progress=bar:force:noscroll -O "${target_path}.tmp" "${HF_BASE}/${hf_subpath}" && \
            mv "${target_path}.tmp" "$target_path"
        if [ $? -eq 0 ]; then
            local size=$(du -h "$target_path" | cut -f1)
            echo "[DOWNLOADED] $filename ($size)"
        else
            echo "[ERROR] Failed to download $filename"
            rm -f "${target_path}.tmp"
        fi
    fi
}

download_model "$VOLUME_MODELS/text_encoders/umt5_xxl_fp16.safetensors" \
    "split_files/text_encoders/umt5_xxl_fp16.safetensors"

download_model "$VOLUME_MODELS/diffusion_models/wan2.1_i2v_720p_14B_bf16.safetensors" \
    "split_files/diffusion_models/wan2.1_i2v_720p_14B_bf16.safetensors"

download_model "$VOLUME_MODELS/vae/wan_2.1_vae.safetensors" \
    "split_files/vae/wan_2.1_vae.safetensors"

download_model "$VOLUME_MODELS/clip_vision/clip_vision_h.safetensors" \
    "split_files/clip_vision/clip_vision_h.safetensors"

echo ""
echo "--- Model directories ---"
for dir in text_encoders diffusion_models vae clip_vision; do
    echo "$dir: $(ls "$VOLUME_MODELS/$dir/" 2>/dev/null || echo '(empty)')"
done

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
