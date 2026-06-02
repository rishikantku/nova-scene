import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import { MockVideoProvider } from './core/provider';
import { RunPodVideoProvider } from './core/runpod_provider';
import { NovaSceneOrchestrator } from './core/orchestrator';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(cors());
app.use(express.json());
app.use('/static', express.static(path.join(process.cwd(), 'static')));

// In-memory mock database of jobs and scenes for local run
interface Scene {
  id: string;
  index: number;
  prompt: string;
  duration: number;
  status: 'pending' | 'generating_image' | 'generating_motion' | 'completed' | 'failed';
  imageUrl?: string | null;
  videoUrl?: string | null;
}

interface Job {
  jobId: string;
  projectId: string;
  status: 'queued' | 'analyzing' | 'processing_scenes' | 'stitching' | 'completed' | 'failed';
  progress: number;
  prompt: string;
  scenes: Scene[];
  video?: {
    videoUrl: string;
    audioUrl?: string;
    thumbnailUrl: string;
    duration: number;
    fileSizeStr: string;
  } | null;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
  includeAudio?: boolean;
  audioPrompt?: string;
  videoEngine: string;
}

const MOCK_JOBS: Record<string, Job> = {};

// Active SSE client connections
const sseClients: Record<string, Response[]> = {};

function notifyClients(jobId: string) {
  const clients = sseClients[jobId] || [];
  const job = MOCK_JOBS[jobId];
  if (!job) {
    console.log(`[SSE] Warning: notifyClients called for non-existent job ${jobId}`);
    return;
  }

  const payload = {
    job_id: job.jobId,
    status: job.status,
    overall_progress: job.progress,
    scenes: job.scenes,
    video: job.video,
    error_message: job.errorMessage
  };

  console.log(`[SSE] Notifying ${clients.length} active clients for job ${jobId} (status: ${job.status}, progress: ${job.progress}%)`);

  clients.forEach((res, index) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err: any) {
      console.error(`[SSE] Failed writing to client index ${index} for job ${jobId}:`, err.message);
    }
  });
}

// Background simulation of the rendering pipeline
async function simulateJobPipeline(jobId: string, prompt: string, includeAudio: boolean = false, audioPrompt: string = "", videoEngine: string = "wan") {
  console.log(`[Pipeline] Beginning execution for job ${jobId}`);
  const job = MOCK_JOBS[jobId];
  if (!job) {
    console.error(`[Pipeline] Job ${jobId} not found in database!`);
    return;
  }

  // Detect RunPod API configuration
  const apiKey = process.env.RUNPOD_API_KEY;
  const isMock = !apiKey || apiKey === 'mock-runpod-key';

  let provider;
  if (isMock) {
    provider = new MockVideoProvider();
    console.log('[Pipeline] Using MockVideoProvider');
  } else {
    provider = new RunPodVideoProvider({
      apiKey: apiKey!,
      fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID || '',
      wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID || '',
      ltxEndpointId: process.env.RUNPOD_LTX_ENDPOINT_ID || '',
      audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID || '',
    });
    console.log(`[Pipeline] Using RunPodVideoProvider (Flux: ${process.env.RUNPOD_FLUX_ENDPOINT_ID}, Wan: ${process.env.RUNPOD_WAN_ENDPOINT_ID}, LTX: ${process.env.RUNPOD_LTX_ENDPOINT_ID}, Audio: ${process.env.RUNPOD_AUDIO_ENDPOINT_ID})`);
  }

  const orchestrator = new NovaSceneOrchestrator(provider);

  try {
    await orchestrator.executeJob(jobId, prompt, includeAudio, audioPrompt, videoEngine, (update) => {
      // Map progress updates back to the job record
      if (update.status) job.status = update.status;
      if (update.progress !== undefined) job.progress = update.progress;
      if (update.scenes) {
        // Map OrchestratorScene to Local Express Scene interface
        job.scenes = update.scenes.map((s) => ({
          id: s.id,
          index: s.index,
          prompt: s.prompt,
          duration: s.duration,
          status: s.status,
          imageUrl: s.imageUrl,
          videoUrl: s.videoUrl
        }));
      }
      if (update.video !== undefined) job.video = update.video;
      if (update.errorMessage !== undefined) job.errorMessage = update.errorMessage;

      notifyClients(jobId);
    });

    job.completedAt = new Date().toISOString();
    notifyClients(jobId);
  } catch (error: any) {
    console.error(`[Pipeline] Error during job pipeline simulation:`, error.message);
    job.status = 'failed';
    job.errorMessage = error.message || 'Pipeline execution failed';
    notifyClients(jobId);
  }
}

app.post('/api/v1/jobs', (req: Request, res: Response) => {
  const { prompt, include_audio, audio_prompt, video_engine } = req.body;
  console.log(`[POST] /api/v1/jobs received prompt: "${prompt}" (Engine: ${video_engine || 'wan'})`);
  if (!prompt) {
    console.log(`[POST] Error: prompt missing in body`);
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const jobId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  MOCK_JOBS[jobId] = {
    jobId,
    projectId,
    status: 'queued',
    progress: 0,
    prompt,
    scenes: [],
    video: null,
    createdAt: new Date().toISOString(),
    includeAudio: include_audio || false,
    audioPrompt: audio_prompt || "",
    videoEngine: video_engine || "wan"
  };

  // Trigger non-blocking async process
  console.log(`[POST] Job ${jobId} initialized. Starting background pipeline...`);
  simulateJobPipeline(jobId, prompt, include_audio, audio_prompt, video_engine || "wan");

  return res.status(202).json({
    job_id: jobId,
    project_id: projectId,
    status: 'queued',
    progress: 0,
    created_at: MOCK_JOBS[jobId].createdAt
  });
});

app.get('/api/v1/jobs/:job_id', (req: Request, res: Response) => {
  const { job_id } = req.params;
  const job = MOCK_JOBS[job_id];

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.json({
    job_id: job.jobId,
    project_id: job.projectId,
    status: job.status,
    overall_progress: job.progress,
    scenes: job.scenes,
    video: job.video,
    error_message: job.errorMessage,
    created_at: job.createdAt
  });
});

app.get('/api/v1/jobs/:job_id/stream', (req: Request, res: Response) => {
  const { job_id } = req.params;
  console.log(`[GET] /api/v1/jobs/${job_id}/stream - Client attempting to connect`);
  const job = MOCK_JOBS[job_id];

  if (!job) {
    console.log(`[GET] Stream connection rejected: Job ${job_id} not found`);
    return res.status(404).json({ error: 'Job not found' });
  }

  // Set explicit headers and writeHead immediately to open connection channel
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  if (!sseClients[job_id]) {
    sseClients[job_id] = [];
  }
  sseClients[job_id].push(res);
  console.log(`[SSE] Client registered. Active streams for job ${job_id}: ${sseClients[job_id].length}`);

  // Send initial state immediately
  const payload = {
    job_id: job.jobId,
    status: job.status,
    overall_progress: job.progress,
    scenes: job.scenes,
    video: job.video,
    error_message: job.errorMessage
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);

  req.on('close', () => {
    sseClients[job_id] = sseClients[job_id].filter((client) => client !== res);
    console.log(`[SSE] Client disconnected for job ${job_id}. Remaining streams: ${sseClients[job_id].length}`);
  });
});

export default app;
