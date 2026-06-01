# NovaScene OpenAPI 3.0 Specifications

The NovaScene backend REST API is exposed by FastAPI. The frontend communicates with it to submit rendering jobs, monitor execution states, and fetch generation histories.

---

## 1. OpenAPI Interface Summary

### 1.1 Job Creation
- **Endpoint**: `POST /api/v1/jobs`
- **Description**: Submits a natural language prompt, starts prompt analysis, splits it into scenes, and triggers parallel worker pipelines.
- **Request Body** (`application/json`):
  ```json
  {
    "prompt": "A futuristic samurai walking through neon Tokyo in the rain, cinematic, dramatic lighting",
    "aspect_ratio": "16:9",
    "duration_target": 15
  }
  ```
- **Response** (`202 Accepted`):
  ```json
  {
    "job_id": "893cfa32-601d-40ce-8c7e-e5b1dfeb7111",
    "project_id": "ac870c91-912b-42ab-ba0d-13cc929eb9cf",
    "status": "queued",
    "overall_progress": 0,
    "created_at": "2026-06-01T14:00:00Z"
  }
  ```

---

### 1.2 Get Job Status
- **Endpoint**: `GET /api/v1/jobs/{job_id}`
- **Description**: Returns the complete execution state, including individual scene metrics.
- **Response** (`200 OK`):
  ```json
  {
    "job_id": "893cfa32-601d-40ce-8c7e-e5b1dfeb7111",
    "status": "processing_scenes",
    "overall_progress": 50,
    "scenes": [
      {
        "scene_index": 1,
        "prompt": "wide cinematic shot of futuristic Tokyo streets",
        "duration": 4,
        "status": "completed",
        "image_url": "https://r2.novascene.ai/scenes/keyframe_1.jpg",
        "video_url": "https://r2.novascene.ai/scenes/motion_1.mp4"
      },
      {
        "scene_index": 2,
        "prompt": "close-up samurai walking through rain",
        "duration": 5,
        "status": "generating_motion",
        "image_url": "https://r2.novascene.ai/scenes/keyframe_2.jpg",
        "video_url": null
      }
    ],
    "video": null,
    "error_message": null
  }
  ```

---

### 1.3 Real-Time SSE Stream
- **Endpoint**: `GET /api/v1/jobs/{job_id}/stream`
- **Description**: Establishes a persistent Server-Sent Events channel to stream fine-grained rendering updates.
- **Response Header**: `Content-Type: text/event-stream`
- **Events**:
  - `status_change`: Job level status updates (`queued`, `analyzing`, `processing_scenes`, `stitching`, `completed`, `failed`).
  - `scene_progress`: Sent when a scene transitions from `pending` -> `generating_image` -> `generating_motion` -> `completed`.
  - `completed`: Delivers final MP4 video link and primary thumbnail url.

---

### 1.4 Get Job History
- **Endpoint**: `GET /api/v1/jobs`
- **Description**: Returns a paginated list of all generated jobs.
- **Query Parameters**:
  - `limit` (default: 20): Number of records.
  - `offset` (default: 0): Pagination offset.
- **Response** (`200 OK`):
  ```json
  {
    "total": 1,
    "limit": 20,
    "offset": 0,
    "items": [
      {
        "job_id": "893cfa32-601d-40ce-8c7e-e5b1dfeb7111",
        "original_prompt": "A futuristic samurai walking through neon Tokyo...",
        "status": "completed",
        "created_at": "2026-06-01T14:00:00Z",
        "video": {
          "video_url": "https://r2.novascene.ai/videos/final_output.mp4",
          "thumbnail_url": "https://r2.novascene.ai/videos/thumbnail.jpg",
          "duration": 9
        }
      }
    ]
  }
  ```

---

### 1.5 Delete Job/Video
- **Endpoint**: `DELETE /api/v1/jobs/{job_id}`
- **Description**: Removes the database record and schedules an asynchronous cleanup job to delete all associated assets from Cloudflare R2.
- **Response** (`204 No Content`)

---

## 2. API Contract Schema Models (Pydantic Structures)

```python
# app/schemas/job.py
from pydantic import BaseModel, HttpUrl
from typing import List, Optional
from datetime import datetime
from uuid import UUID

class JobCreate(BaseModel):
    prompt: str
    aspect_ratio: Optional[str] = "16:9"
    duration_target: Optional[int] = 15

class SceneResponse(BaseModel):
    scene_index: int
    prompt: str
    duration: int
    status: str
    image_url: Optional[str] = None
    video_url: Optional[str] = None

class VideoResponse(BaseModel):
    video_url: str
    thumbnail_url: str
    duration: int
    file_size_bytes: int

class JobResponse(BaseModel):
    job_id: UUID
    project_id: UUID
    status: str
    overall_progress: int
    scenes: List[SceneResponse]
    video: Optional[VideoResponse] = None
    error_message: Optional[str] = None
    created_at: datetime
```
