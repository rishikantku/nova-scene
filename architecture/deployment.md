# NovaScene Deployment, Observability & Security Architecture

NovaScene utilizes a hybrid deployment architecture: a **Control Plane** for client-facing web services, API orchestration, and databases, and an isolated **GPU Plane** for distributed heavy inference tasks.

---

## 1. Hybrid Infrastructure Layout

```text
    ┌───────────────────────────────────┐      ┌───────────────────────────────────┐
    │           CONTROL PLANE           │      │             GPU PLANE             │
    │  (Railway / Fly.io / AWS ECS)     │      │         (RunPod Serverless)       │
    │                                   │      │                                   │
    │   ┌───────────┐   ┌───────────┐   │      │   ┌───────────┐   ┌───────────┐   │
    │   │  Next.js  │   │  FastAPI  │   │      │   │   Flux    │   │  Wan 2.1  │   │
    │   │  Frontend │   │    App    │   │      │   │  Workers  │   │  Workers  │   │
    │   └─────┬─────┘   └─────┬─────┘   │      │   └─────▲─────┘   └─────▲─────┘   │
    └─────────┼───────────────┼─────────┘      └─────────┼─────────────┼───────────┘
              │               │                          │             │
              ▼               ▼                          │             │
        ┌───────────┐   ┌─────┴─────┐                    │             │
        │ Cloudflare│   │  Postgres │◄───────────────────┼─────────────┘
        │    R2     │   │  & Redis  │                    │
        │  (Bucket) │   └───────────┘                    │
        └─────▲─────┘                                    │
              └──────────────────────────────────────────┘
```

---

## 2. CI/CD Pipeline Design (GitHub Actions)

A multi-stage GitHub Actions pipeline manages build testing, static type verification, docker packaging, and automated blue-green deployments.

### Stage 1: Build & Lint
- Triggered on push to `main` or pull requests.
- Runs Next.js build validation and lints.
- Executes Python Pytest suites in the backend directory.

### Stage 2: Container Compilation & Push
- Builds optimized multi-stage Dockerfiles (`docker/Dockerfile.api` and `docker/Dockerfile.worker`).
- Publishes images to GitHub Container Registry (GHCR) or AWS ECR.

### Stage 3: Rolling Deployments
- Control Plane services are updated rolling-over.
- RunPod Serverless endpoints are updated by pointing their template digests to the newly compiled image hashes.

---

## 3. Observability Architecture (OpenTelemetry, Grafana)

To trace long-running jobs across separate environments (web app and remote GPUs):
1. **Distributed Tracing**: When a job starts, the FastAPI orchestrator injects an `otlp` trace ID (`traceparent` header). The worker reads this ID from the task payload and logs all GPU metrics under the same context.
2. **Key Metrics to Track**:
   - **Queue Latency**: Time elapsed between job creation and worker pull.
   - **Inference Speed**: Seconds per frame (SPF) for Flux and Wan pipelines.
   - **Render Failure Rate**: Percentage of tasks requiring restarts or failing.
   - **Compute Spend**: Correlate active GPU runtime to RunPod billing units.
3. **Structured Logs**: All logs are written in JSON format to stdout, captured by Datadog or Vector, and indexed in Grafana Loki:
   ```json
   {"timestamp": "2026-06-01T14:02:00Z", "level": "INFO", "trace_id": "893cfa32", "message": "Starting Wan 2.1 motion generation", "scene_index": 2}
   ```

---

## 4. Cost Optimization Strategy
- **Aggressive Idle Timeout**: GPU workers poll jobs from Redis. If the queue remains empty for 5 minutes, workers shut down.
- **Scene Caching**: Skip GPU execution if an identical scene prompt already generated an asset (verified via SHA-256 hash search in database).
- **Quantized Inference Models**: Use FP8 or NF4 versions of Flux 1.2.1 and Wan 2.1 to fit model pipelines onto 24GB GPUs (e.g. RTX 4090) instead of requiring expensive A100 instances, cutting hosting costs by up to 70%.

---

## 5. Security Recommendations
- **Isolated Workers**: GPU workers have absolutely no access to the production database credentials. They interact purely through the queue broker (Redis/BullMQ credentials) and pre-authenticated Cloudflare R2 presigned URLs.
- **Signed URL Access**: The browser client is never given direct access to the R2 bucket. Instead, the FastAPI backend serves video previews and assets using Cloudflare R2 Presigned URLs with a 15-minute expiration window.
- **Rate Limiting**: Apply token bucket rate limiting on the `/api/v1/jobs` endpoints to prevent denial-of-wallet (DoW) attacks where malicious users submit thousands of rendering requests.
