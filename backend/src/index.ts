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
  status: 'queued' | 'analyzing' | 'awaiting_approval' | 'processing_scenes' | 'stitching' | 'completed' | 'failed';
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

// Phase 1: Planning (LLM / Director)
async function simulateJobPlanningPhase(jobId: string, prompt: string, duration: number = 15) {
  console.log(`[Pipeline] Beginning planning phase for job ${jobId}`);
  const job = MOCK_JOBS[jobId];
  if (!job) {
    console.error(`[Pipeline] Job ${jobId} not found in database!`);
    return;
  }

  job.status = 'analyzing';
  job.progress = 10;
  notifyClients(jobId);

  // We need a dummy provider just to initialize the orchestrator
  const provider = new MockVideoProvider();
  const orchestrator = new NovaSceneOrchestrator(provider);

  try {
    const scenes = await orchestrator.splitPromptIntoScenes(prompt, duration);
    
    job.scenes = scenes.map((s) => ({
      id: `scene-${s.sceneIndex}-${crypto.randomUUID()}`,
      index: s.sceneIndex,
      prompt: s.prompt,
      duration: s.duration,
      status: 'pending'
    }));

    job.status = 'awaiting_approval';
    job.progress = 20;
    notifyClients(jobId);
    console.log(`[Pipeline] Job ${jobId} planning complete. Awaiting user approval.`);
  } catch (error: any) {
    console.error(`[Pipeline] Error during planning:`, error.message);
    job.status = 'failed';
    job.errorMessage = error.message || 'Planning failed';
    notifyClients(jobId);
  }
}

// Phase 2: Heavy GPU Rendering
async function simulateJobRenderPhase(jobId: string) {
  console.log(`[Pipeline] Beginning render phase for job ${jobId}`);
  const job = MOCK_JOBS[jobId];
  if (!job) {
    console.error(`[Pipeline] Job ${jobId} not found in database!`);
    return;
  }

  job.status = 'processing_scenes';
  notifyClients(jobId);

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
    // We pass the scenes stored in the DB (which the user approved) to the orchestrator
    await orchestrator.executeJobRenderPhase(
      jobId, 
      job.scenes, 
      job.includeAudio, 
      job.audioPrompt, 
      job.videoEngine, 
      (update) => {
        // Map progress updates back to the job record
        if (update.status) job.status = update.status as any; // Cast from orchestrator status
        if (update.progress !== undefined) job.progress = update.progress;
        if (update.scenes) {
          // Update scene statuses
          update.scenes.forEach(us => {
            const ls = job.scenes.find(s => s.index === us.index);
            if (ls) {
              ls.status = us.status;
              ls.imageUrl = us.imageUrl;
              ls.videoUrl = us.videoUrl;
            }
          });
        }
        if (update.video !== undefined) job.video = update.video;
        if (update.errorMessage !== undefined) job.errorMessage = update.errorMessage;

        notifyClients(jobId);
      }
    );

    job.completedAt = new Date().toISOString();
    notifyClients(jobId);
  } catch (error: any) {
    console.error(`[Pipeline] Error during render phase:`, error.message);
    job.status = 'failed';
    job.errorMessage = error.message || 'Pipeline execution failed';
    notifyClients(jobId);
  }
}

app.post('/api/v1/jobs', (req: Request, res: Response) => {
  const { prompt, duration_target, include_audio, audio_prompt, video_engine } = req.body;
  const duration = duration_target || 15;
  console.log(`[POST] /api/v1/jobs received prompt: "${prompt}" (Engine: ${video_engine || 'wan'}, Duration: ${duration}s)`);
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
  console.log(`[POST] Job ${jobId} initialized. Starting planning phase...`);
  simulateJobPlanningPhase(jobId, prompt, duration);

  return res.status(202).json({
    job_id: jobId,
    project_id: projectId,
    status: 'queued',
    progress: 0,
    created_at: MOCK_JOBS[jobId].createdAt
  });
});

app.post('/api/v1/jobs/:job_id/approve', (req: Request, res: Response) => {
  const { job_id } = req.params;
  const job = MOCK_JOBS[job_id];

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'awaiting_approval') {
    return res.status(400).json({ error: 'Job is not awaiting approval' });
  }

  console.log(`[POST] /api/v1/jobs/${job_id}/approve - User approved scenes. Starting render phase...`);
  
  // Trigger rendering asynchronously
  simulateJobRenderPhase(job_id);

  return res.status(200).json({ success: true, message: 'Rendering started' });
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
