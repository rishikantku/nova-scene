# NovaScene Database Architecture & Schema Design

NovaScene uses a **PostgreSQL** database designed to store relational records (projects, jobs, scenes, compiled videos, assets) while keeping large binary content stored in Cloudflare R2 object storage.

---

## 1. Entity Relationship Overview

```text
  [users] 
     │
     └───► [projects]
               │
               └───► [jobs]
                       │
                       ├───► [scenes] (Parallelized frames/videos)
                       │
                       └───► [videos] (Stitched final renders)
                                │
                                └───► [assets] (Storage index)
```

---

## 2. Table Definitions (SQL DDL)

Below are the production-grade PostgreSQL DDL statements including indexing strategies.

### 2.1 Users Table
*Note: Stubbed default user ID `00000000-0000-0000-0000-000000000000` is seeded automatically for anonymous auth.*

```sql
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Seed user for auth-bypass
INSERT INTO users (id, email)
VALUES ('00000000-0000-0000-0000-000000000000', 'guest@novascene.ai')
ON CONFLICT (id) DO NOTHING;
```

### 2.2 Projects Table
Projects organize multiple jobs (versions) of a single prompt idea.

```sql
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    original_prompt TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_projects_user_id ON projects(user_id);
```

### 2.3 Jobs Table
Tracks the status and progress of rendering workflows.

```sql
CREATE TYPE job_status AS ENUM ('queued', 'analyzing', 'processing_scenes', 'stitching', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status job_status DEFAULT 'queued' NOT NULL,
    overall_progress INT DEFAULT 0 NOT NULL,
    error_message TEXT,
    retry_count INT DEFAULT 0 NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_jobs_project_id ON jobs(project_id);
CREATE INDEX idx_jobs_status ON jobs(status) WHERE status != 'completed';
```

### 2.4 Scenes Table
Represents individual segments generated in parallel.

```sql
CREATE TYPE scene_status AS ENUM ('pending', 'generating_image', 'generating_motion', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS scenes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    scene_index INT NOT NULL,
    prompt TEXT NOT NULL,
    duration INT NOT NULL DEFAULT 4, -- duration in seconds
    status scene_status DEFAULT 'pending' NOT NULL,
    image_url VARCHAR(1024),          -- Flux 1.2.1 output in R2
    video_url VARCHAR(1024),          -- Wan 2.1 motion output in R2
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE (job_id, scene_index)
);

CREATE INDEX idx_scenes_job_id ON scenes(job_id);
```

### 2.5 Videos Table
Stores final stitched video information.

```sql
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID UNIQUE NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    video_url VARCHAR(1024) NOT NULL,
    thumbnail_url VARCHAR(1024) NOT NULL,
    duration INT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### 2.6 Assets Table
Tracks all media files uploaded to R2 bucket for lifecycle cleanup policies.

```sql
CREATE TYPE asset_type AS ENUM ('image_keyframe', 'video_scene', 'video_final', 'thumbnail');

CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    asset_type asset_type NOT NULL,
    r2_key VARCHAR(512) UNIQUE NOT NULL,
    cdn_url VARCHAR(1024) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_assets_job_id ON assets(job_id);
```

### 2.7 Billing Table
Prepares system database for credits / SaaS models.

```sql
CREATE TABLE IF NOT EXISTS billing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credits_balance DECIMAL(10, 2) DEFAULT 100.00 NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### 2.8 Moderation Logs Table
Logs audits of generation safety (hook endpoints reserved for future plugins).

```sql
CREATE TABLE IF NOT EXISTS moderation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    flagged BOOLEAN DEFAULT FALSE NOT NULL,
    category_scores JSONB, -- stores classification results
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_moderation_logs_flagged ON moderation_logs(flagged) WHERE flagged = TRUE;
```

---

## 3. High-Performance Indexing & Constraints
1. **Partial Index on Active Jobs**: `idx_jobs_status` filters out `'completed'` status. This optimizes dashboard rendering, which primarily fetches active or queued rendering tasks.
2. **Cascading Deletes**: If a project is deleted, all child jobs, scenes, videos, and billing hooks are cleaned up recursively. Associated R2 files will be garbage-collected asynchronously using background cleanup jobs matching entries in the `assets` table.
3. **Optimistic Locking / State Audit**: All write operations updating status fields must ensure states only move forward (e.g. `queued` -> `analyzing` -> `processing_scenes`). This is enforced at the DB level or inside database transaction locks.
