# docker/Dockerfile.gpu-worker
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies (ffmpeg is needed for video compiles)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch, Diffusers, and boto3 for R2 uploads
RUN pip install --no-cache-dir \
    runpod==1.6.2 \
    diffusers==0.32.1 \
    transformers==4.45.0 \
    accelerate==0.34.0 \
    peft==0.12.0 \
    einops \
    boto3==1.34.50 \
    requests==2.31.0 \
    pillow==10.2.0 \
    protobuf==4.25.3 \
    sentencepiece==0.2.0 \
    opencv-python-headless==4.9.0.80 \
    certifi

# Copy worker script handlers
COPY worker/src/flux_handler.py ./flux_handler.py
COPY worker/src/wan_handler.py ./wan_handler.py

# Default entry point (overridden in RunPod serverless console)
CMD ["python", "-u", "flux_handler.py"]
# cache bust to fix runpod layer corruption
