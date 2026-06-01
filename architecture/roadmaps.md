# NovaScene Roadmap & Moderation Extension Points

This roadmap details the sequential milestones for NovaScene, transitioning from a functional MVP to a scalable, production-ready SaaS platform, including future expansion points for content safety.

---

## 1. MVP Roadmap (Phase 1 — Current Focus)

**Goal**: Build a functional end-to-end pipeline that handles prompt splitting, parallel image and video rendering, stitching, and displays updates on a responsive premium UI.

### Key Milestones
1. **Infrastructure Scaffolding**: Setup PostgreSQL tables, Redis queue broker, and Cloudflare R2 bucket connection.
2. **Orchestration Layer**: Develop the FastAPI backend, implementing prompt analysis using a lightweight LLM and task distribution to the worker queues.
3. **Inference Workers**: Package stateless Flux 1.2.1 and Wan 2.1 containers. Build simple simulator setups for offline dev testing.
4. **Stitching Module**: Implement the FFmpeg assembly script to merge scene video segments into an optimized H264 MP4.
5. **Dashboard Workstation**: Create the Next.js UI including the prompt input panel, generation screen, and interactive scene progress cards.

---

## 2. Production Roadmap (Phase 2)

**Goal**: Implement commercialization, account management, persistent workspaces, billing, and system reliability.

### Key Milestones
1. **State Orchestrator Upgrade**: Migrate the simple Redis queuing engine to a robust **Temporal** workflow cluster for transaction safety, visual state tracking, and resumable execution.
2. **Authentication Integration**: Implement Clerk or Firebase Auth. Bind user sessions, workspaces, and projects to secure account IDs.
3. **Monetization & Billing**: Integrate Stripe. Introduce a credit quota system where each scene render deducts a set value from the user's billing balances.
4. **Enhanced Timelines**: Add audio timeline tracks. Enable users to upload background music, voiceovers, or generate AI narration (via TTS) to overlay onto the compiled video.
5. **Advanced Models**: Support character consistency via LoRA weights, custom style models, and higher resolution upscaling.

---

## 3. Future Moderation Extension Points

While the MVP skips NSFW scanning and prompt filtering for rapid prototyping, the system architecture leaves explicit hooks for safety pipelines.

```text
               ┌───────────────────────┐
               │    Client Prompt      │
               └───────────┬───────────┘
                           │
             [Hook 1: Prompt Filter Check]
                           │
                           ▼
               ┌───────────────────────┐
               │    LLM Scene Split    │
               └───────────┬───────────┘
                           │
             [Hook 2: Keyframe Image Check]
                           │
                           ▼
               ┌───────────────────────┐
               │  Motion Video Render  │
               └───────────┬───────────┘
                           │
             [Hook 3: Final Video Scan]
                           │
                           ▼
               ┌───────────────────────┐
               │  R2 Storage / Delivery│
               └───────────────────────┘
```

### The Three Safety Gateways
1. **Prompt Moderation (Hook 1)**: Before writing the project to the database, dispatch the prompt to OpenAI's Moderation API or Llama Guard. If flagged, return a `422 Unprocessable Entity` with details of the violation.
2. **Keyframe Scan (Hook 2)**: Before triggering the slow motion-generation queue, inspect the Flux-generated keyframe using an image safety model (e.g. Google Cloud Vision or a lightweight ViT NSFW classifier). If flagged, halt the pipeline, update scene status to `failed`, and write to `moderation_logs`.
3. **Video Content Verification (Hook 3)**: After FFmpeg compiles the final MP4, run a lightweight video content classifier on sample keyframes before making the download link public.
