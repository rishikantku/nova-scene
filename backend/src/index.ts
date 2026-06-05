import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MockVideoProvider } from './core/provider';
import { RunPodVideoProvider } from './core/runpod_provider';
import { NovaSceneOrchestrator } from './core/orchestrator';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(cors({ origin: '*' })); // Allow all origins so Vercel can connect
app.use(express.json());

app.use(async (req, res, next) => {
  if (IS_SERVERLESS) {
    await loadDb();
  }
  next();
});

app.use('/static', express.static(path.join(process.cwd(), 'static')));

// In-memory mock database of jobs and scenes for local run
interface Scene {
  id: string;
  index: number;
  prompt: string;
  narration?: string;
  duration: number;
  status: 'pending' | 'generating_image' | 'generating_motion' | 'completed' | 'failed';
  imageUrl?: string | null;
  videoUrl?: string | null;
  loraSafetensorsUrl?: string;
  loraTriggerToken?: string;
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

interface Character {
  id: string;
  projectId?: string;
  name: string;
  gender: string;
  appearance: string;
  outfit: string;
  visualStyle: string;
  imageUrl: string | null;
  createdAt: string;
  loraId?: string;
  status?: 'generating' | 'ready';
}

interface LoraMetadata {
  id: string;
  characterId: string;
  version: number;
  triggerToken: string;
  datasetUrls: string[];
  status: 'generating_dataset' | 'dataset_ready' | 'training' | 'completed' | 'failed';
  safetensorsUrl?: string;
  createdAt: string;
}

import fs from 'fs';
import { loadDbFromS3OrLocal, saveDbToS3OrLocal } from './s3db';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

// On Railway or EC2, they can map a persistent volume and set DB_PATH=/data/db.json
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'db.json');
const IS_SERVERLESS = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const MOCK_JOBS: Record<string, Job> = {};
const MOCK_CHARACTERS: Record<string, Character> = {};
const MOCK_LORAS: Record<string, LoraMetadata> = {};

interface Story {
  id: string;
  title: string;
  genre: string;
  visualStyle: string;
  targetDuration: number;
  videoEngine: string;
  castIds: string[]; // references to Character.id
  status: 'draft' | 'generating_board' | 'board_ready' | 'generating_video' | 'completed' | 'failed';
  scenes: Scene[];
  finalVideoUrl?: string;
  generatedAudioUrl?: string;
  generatedVoiceoverUrl?: string;
  includeAudio?: boolean;
  audioPrompt?: string;
  createdAt: string;
}

const MOCK_STORIES: Record<string, Story> = {};

// Load database from disk/S3
export async function loadDb() {
  try {
    const data = await loadDbFromS3OrLocal(DB_PATH);
    Object.assign(MOCK_JOBS, data.jobs || {});
    Object.assign(MOCK_CHARACTERS, data.characters || {});
    Object.assign(MOCK_STORIES, data.stories || {});
    Object.assign(MOCK_LORAS, data.loras || {});
    if (!IS_SERVERLESS) console.log(`[DB] Loaded persistent mock database`);
  } catch (e) {
    console.error(`[DB] Error loading mock database`, e);
  }
}

// Initial load for local dev
if (!IS_SERVERLESS) {
  loadDb();
}

// Save database to disk/S3
export async function saveDb() {
  const data = {
    jobs: MOCK_JOBS,
    characters: MOCK_CHARACTERS,
    stories: MOCK_STORIES,
    loras: MOCK_LORAS
  };
  await saveDbToS3OrLocal(data, DB_PATH);
}

// Only poll saves in local dev. In serverless, we await saveDb() on requests.
if (!IS_SERVERLESS) {
  setInterval(() => {
    saveDb().catch(console.error);
  }, 2000);
}

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

// Phase 1: LLM Prompt Planning
export async function simulateJobPlanningPhase(jobId: string, prompt: string, duration: number = 15, visualStyle: string = "Cinematic") {
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
    const result = await orchestrator.splitPromptIntoScenes(prompt, duration, visualStyle);
    
    job.scenes = result.scenes.map((s: any) => ({
      id: `scene-${s.sceneIndex}-${crypto.randomUUID()}`,
      index: s.sceneIndex,
      prompt: s.prompt,
      narration: s.narration || '',
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
export async function simulateJobRenderPhase(jobId: string) {
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
      loraEndpointId: process.env.RUNPOD_LORA_ENDPOINT_ID || '',
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
      undefined,
      undefined,
      (update: any) => {
        // Map progress updates back to the job record
        if (update.status) job.status = update.status as any; // Cast from orchestrator status
        if (update.progress !== undefined) job.progress = update.progress;
        if (update.scenes) {
          // Update scene statuses
          update.scenes.forEach((us: any) => {
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

app.post('/api/v1/jobs', async (req: Request, res: Response) => {
  const { prompt, duration_target, include_audio, audio_prompt, video_engine, visual_style } = req.body;
  const duration = duration_target || 15;
  const style = visual_style || "Cinematic";
  console.log(`[POST] /api/v1/jobs received prompt: "${prompt}" (Engine: ${video_engine || 'wan'}, Duration: ${duration}s, Style: ${style})`);
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
  if (IS_SERVERLESS && process.env.SQS_QUEUE_URL) {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({ type: 'plan', jobId, prompt, duration, visualStyle: style })
    }));
  } else {
    simulateJobPlanningPhase(jobId, prompt, duration, style);
  }

  return res.status(202).json({
    job_id: jobId,
    project_id: projectId,
    status: 'queued',
    progress: 0,
    created_at: MOCK_JOBS[jobId].createdAt
  });
});

app.post('/api/v1/jobs/:job_id/approve', async (req: Request, res: Response) => {
  const { job_id } = req.params;
  const job = MOCK_JOBS[job_id];

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'awaiting_approval') {
    return res.status(400).json({ error: 'Job is not awaiting approval' });
  }

  console.log(`[POST] /api/v1/jobs/${job_id}/approve - User approved scenes. Starting render phase...`);
  
  if (IS_SERVERLESS && process.env.SQS_QUEUE_URL) {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({ type: 'render', jobId: job_id })
    }));
  } else {
    simulateJobRenderPhase(job_id);
  }

  return res.status(202).json({ success: true, message: 'Rendering started' });
});

app.put('/api/v1/jobs/:job_id/scenes/:scene_id', (req: Request, res: Response) => {
  const { job_id, scene_id } = req.params;
  const { prompt, duration } = req.body;
  const job = MOCK_JOBS[job_id];

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'awaiting_approval') {
    return res.status(400).json({ error: 'Job is not awaiting approval' });
  }

  const scene = job.scenes.find((s: any) => s.id === scene_id);
  if (!scene) {
    return res.status(404).json({ error: 'Scene not found' });
  }

  if (prompt !== undefined) scene.prompt = prompt;
  if (duration !== undefined) scene.duration = Number(duration);

  console.log(`[PUT] /api/v1/jobs/${job_id}/scenes/${scene_id} - Scene updated`);
  notifyClients(job_id);

  return res.status(200).json({ success: true, scene });
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

// ---------------------------------------------------------------------------
// Character Persistence Endpoints
// ---------------------------------------------------------------------------

app.get('/api/v1/upload-url', async (req: Request, res: Response) => {
  const fileName = req.query.fileName as string;
  const fileType = req.query.fileType as string;

  if (!fileName || !fileType) {
    return res.status(400).json({ error: 'fileName and fileType query params required' });
  }

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT_URL,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
  });

  const bucketName = process.env.R2_BUCKET_NAME || 'novascene-assets';
  const cdnUrl = process.env.R2_CDN_URL || 'https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev';
  
  const key = `uploads/${crypto.randomUUID()}_${fileName}`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    const publicUrl = `${cdnUrl}/${key}`;

    res.json({ uploadUrl, publicUrl });
  } catch (error: any) {
    console.error('Failed to generate presigned URL', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

export async function simulateCharacterGeneration(characterId: string, enableLora?: boolean, referenceImageUrl?: string) {
  console.log(`[Pipeline] Beginning character generation for ${characterId}...`);
  const newCharacter = MOCK_CHARACTERS[characterId];
  if (!newCharacter) {
    console.error(`[Pipeline] Character ${characterId} not found in database!`);
    return;
  }

  const apiKey = process.env.RUNPOD_API_KEY;
  const isMock = !apiKey || apiKey === 'mock-runpod-key';

  if (isMock) {
     console.log(`[Characters] Mocking character generation for ${newCharacter.name}...`);
     newCharacter.imageUrl = "https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev/keyframes/keyframe_mock.jpg";
     newCharacter.status = 'ready';
     await saveDb();
     return;
  }

  try {
    const provider = new RunPodVideoProvider({
      apiKey: apiKey!,
      fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID || '',
      wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID || '',
      ltxEndpointId: process.env.RUNPOD_LTX_ENDPOINT_ID || '',
      audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID || '',
      loraEndpointId: process.env.RUNPOD_LORA_ENDPOINT_ID || '',
    });

    let prompt: string;
    let aspectRatio: string;

    if (enableLora) {
      prompt = `A professional multi-angle full-body character reference sheet of a character, ${newCharacter.visualStyle}. ${newCharacter.appearance}. Wearing: ${newCharacter.outfit}. The image must contain three separate views of the exact same character side-by-side: a front view, a side profile view, and a 3/4 angle view. The character must be fully visible from head to toe in all angles. Neutral expression, plain white studio background. Highly detailed, consistent character design across all angles.`;
      aspectRatio = '16:9';
    } else {
      prompt = `A highly detailed ${newCharacter.visualStyle} full-body portrait of a character. ${newCharacter.appearance}. Wearing: ${newCharacter.outfit}. The character must be fully visible from head to toe. Looking directly at the camera with a confident expression. Clean studio lighting, soft bokeh background. Cinematic quality, sharp focus, professional character design.`;
      aspectRatio = '1:1';
    }

    const options: any = {};
    if (referenceImageUrl) {
      options.referenceImageUrl = referenceImageUrl;
    }

    const imageUrl = await provider.generateImage(prompt, aspectRatio, options);
    
    newCharacter.imageUrl = imageUrl;
    newCharacter.status = 'ready';
    MOCK_CHARACTERS[characterId] = newCharacter;
    await saveDb();

    // If Premium mode, kick off LoRA dataset generation + training in the background
    if (enableLora) {
      console.log(`[Characters] Premium mode — starting background LoRA pipeline for ${newCharacter.name}...`);
      
      const loraId = crypto.randomUUID();
      const loraMetadata: LoraMetadata = {
        id: loraId,
        characterId,
        version: 1,
        triggerToken: `ohwx ${newCharacter.name.toLowerCase().replace(/[^a-z]/g, '')}`,
        datasetUrls: [],
        status: 'generating_dataset',
        createdAt: new Date().toISOString()
      };
      MOCK_LORAS[loraId] = loraMetadata;
      newCharacter.loraId = loraId;
      await saveDb();

      try {
        const datasetPrompts = [
          `A close-up portrait of ${newCharacter.appearance}. Wearing: ${newCharacter.outfit}. Neutral expression, looking directly at the camera, plain white background, highly detailed.`,
          `A side profile full-body shot of ${newCharacter.appearance}. Wearing: ${newCharacter.outfit}. The character is fully visible from head to toe. Looking to the right, plain white background, highly detailed.`,
          `A 3/4 angle full-body view of ${newCharacter.appearance}. Wearing: ${newCharacter.outfit}. The character is fully visible from head to toe. Looking slightly away, plain white background, highly detailed.`,
          `A full-body shot of ${newCharacter.appearance}. Wearing: ${newCharacter.outfit}. The character is fully visible from head to toe. Standing naturally, plain white background, highly detailed.`
        ];

        console.log(`[LoRA] Generating ${datasetPrompts.length} dataset images for ${newCharacter.name}...`);
        for (const p of datasetPrompts) {
          const url = await provider.generateImage(p, '1:1');
          loraMetadata.datasetUrls.push(url);
          console.log(`[LoRA] Dataset image ${loraMetadata.datasetUrls.length}/${datasetPrompts.length}`);
        }

        // Dispatch training
        loraMetadata.status = 'training';
        await saveDb();
        console.log(`[LoRA] Dispatching training job for ${newCharacter.name}...`);
        const safetensorsUrl = await provider.trainLora(loraId, loraMetadata.triggerToken, loraMetadata.datasetUrls);
        
        if (safetensorsUrl) {
          loraMetadata.safetensorsUrl = safetensorsUrl;
          loraMetadata.status = 'completed';
          console.log(`[LoRA] ✅ Training complete for ${newCharacter.name}! URL: ${safetensorsUrl}`);
        } else {
          throw new Error('No URL returned from training');
        }
        await saveDb();
      } catch (err: any) {
        console.error(`[LoRA] ❌ Pipeline failed for ${newCharacter.name}:`, err.message);
        loraMetadata.status = 'failed';
        await saveDb();
      }
    }
  } catch (error: any) {
    console.error(`[Characters] Failed to generate character image:`, error);
    // Cleanup character so it doesn't get stuck in "generating" state
    delete MOCK_CHARACTERS[characterId];
    await saveDb();
  }
}

app.post('/api/v1/characters', async (req: Request, res: Response) => {
  const { name, gender, appearance, outfit, visualStyle, enableLora, referenceImageUrl } = req.body;
  if (!name || !appearance) {
    return res.status(400).json({ error: 'Name and appearance are required' });
  }

  const characterId = crypto.randomUUID();
  const newCharacter: Character = {
    id: characterId,
    name,
    gender: gender || 'unspecified',
    appearance,
    outfit: outfit || 'casual',
    visualStyle: visualStyle || 'Cinematic',
    imageUrl: null,
    status: 'generating',
    createdAt: new Date().toISOString()
  };

  MOCK_CHARACTERS[characterId] = newCharacter;
  await saveDb();

  // If serverless, dispatch to SQS
  if (IS_SERVERLESS && process.env.SQS_QUEUE_URL) {
    console.log(`[POST] Dispatching character generation for ${name} to SQS...`);
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({ type: 'character', characterId, enableLora, referenceImageUrl })
    }));
  } else {
    // Local run — run asynchronously in background process (non-blocking)
    console.log(`[POST] Running local background generation for character ${name}...`);
    simulateCharacterGeneration(characterId, enableLora, referenceImageUrl).catch(console.error);
  }

  // Return the character immediately with 202 Accepted
  return res.status(202).json(newCharacter);
});

app.post('/api/v1/characters/:character_id/generate-dataset', async (req: Request, res: Response) => {
  const { characterId } = req.params;
  // Use character_id to match the route param
  const id = req.params.character_id || characterId;
  const character = MOCK_CHARACTERS[id];
  
  if (!character) {
    return res.status(404).json({ error: 'Character not found' });
  }

  // Create LoRA metadata record
  const loraId = crypto.randomUUID();
  const loraMetadata: LoraMetadata = {
    id: loraId,
    characterId: id,
    version: 1,
    triggerToken: `ohwx ${character.name.toLowerCase().replace(/[^a-z]/g, '')}`,
    datasetUrls: [],
    status: 'generating_dataset',
    createdAt: new Date().toISOString()
  };
  
  MOCK_LORAS[loraId] = loraMetadata;
  character.loraId = loraId;
  
  await saveDb();
  res.status(202).json({ success: true, message: 'Dataset generation started', loraId });

  // Start background generation
  try {
    const provider = new RunPodVideoProvider({
      apiKey: process.env.RUNPOD_API_KEY || '',
      fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID || '',
      wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID || '',
      ltxEndpointId: process.env.RUNPOD_LTX_ENDPOINT_ID || '',
      audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID || '',
      loraEndpointId: process.env.RUNPOD_LORA_ENDPOINT_ID || '',
    });

    if (!character.imageUrl) {
      return res.status(400).json({ error: 'Character has no base image' });
    }

    console.log(`[LoRA] Using character sheet for dataset generation for character ${id}...`);
    loraMetadata.datasetUrls = [character.imageUrl];
    loraMetadata.status = 'dataset_ready';
    console.log(`[LoRA] Dataset generation complete! Sending character sheet to LoRA worker for cropping.`);
    
    console.log(`[LoRA] Dispatching training job to LoRA endpoint...`);
    const safetensorsUrl = await provider.trainLora(loraId, loraMetadata.triggerToken, loraMetadata.datasetUrls);
    
    if (safetensorsUrl) {
      loraMetadata.safetensorsUrl = safetensorsUrl;
      loraMetadata.status = 'completed';
      console.log(`[LoRA] Training complete! LoRA URL: ${safetensorsUrl}`);
      await saveDb();
    } else {
      throw new Error("No URL returned from training");
    }
    
  } catch (err) {
    console.error(`[LoRA] Dataset generation failed:`, err);
    loraMetadata.status = 'failed';
    await saveDb();
  }
});

app.get('/api/v1/characters', (req: Request, res: Response) => {
  const characters = Object.values(MOCK_CHARACTERS).sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ).map(c => {
    // Enrich with LoRA training status
    let loraStatus: string | undefined;
    if (c.loraId && MOCK_LORAS[c.loraId]) {
      loraStatus = MOCK_LORAS[c.loraId].status;
    }
    return { ...c, loraStatus };
  });
  return res.json({ characters });
});

app.post('/api/v1/characters/:character_id/regenerate', async (req: Request, res: Response) => {
  const { character_id } = req.params;
  const character = MOCK_CHARACTERS[character_id];
  
  if (!character) {
    return res.status(404).json({ error: 'Character not found' });
  }

  // Update character properties if provided in body
  const { name, gender, appearance, outfit, visualStyle } = req.body;
  if (name) character.name = name;
  if (gender) character.gender = gender;
  if (appearance) character.appearance = appearance;
  if (outfit) character.outfit = outfit;
  if (visualStyle) character.visualStyle = visualStyle;

  // Determine if it was Premium (has a loraId)
  const isPremium = !!character.loraId;

  // Initialize Provider
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey || apiKey === 'mock-runpod-key') {
     console.log(`[Characters] Mocking character regeneration for ${character.name}...`);
     return res.status(200).json(character);
  }

  try {
    const provider = new RunPodVideoProvider({
      apiKey: apiKey,
      fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID || '',
      wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID || '',
      ltxEndpointId: process.env.RUNPOD_LTX_ENDPOINT_ID || '',
      audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID || '',
      loraEndpointId: process.env.RUNPOD_LORA_ENDPOINT_ID || '',
    });

    let prompt: string;
    let aspectRatio: string;

    if (isPremium) {
      prompt = `A professional multi-angle full-body character reference sheet of a character, ${character.visualStyle}. ${character.appearance}. Wearing: ${character.outfit}. The image must contain three separate views of the exact same character side-by-side: a front view, a side profile view, and a 3/4 angle view. The character must be fully visible from head to toe in all angles. Neutral expression, plain white studio background. Highly detailed, consistent character design across all angles.`;
      aspectRatio = '16:9';
      console.log(`[Characters] Regenerating multi-angle full-body character sheet for ${character.name}...`);
    } else {
      prompt = `A highly detailed ${character.visualStyle} full-body portrait of a character. ${character.appearance}. Wearing: ${character.outfit}. The character must be fully visible from head to toe. Looking directly at the camera with a confident expression. Clean studio lighting, soft bokeh background. Cinematic quality, sharp focus, professional character design.`;
      aspectRatio = '1:1';
      console.log(`[Characters] Regenerating single full-body portrait for ${character.name}...`);
    }

    // Mark as generating and immediately return so frontend isn't blocked
    character.status = 'generating';
    await saveDb();
    res.status(202).json(character);

    // Run the rest asynchronously
    (async () => {
      try {
        // Step 1: Regenerate character base image
        const imageUrl = await provider.generateImage(prompt, aspectRatio);
        character.imageUrl = imageUrl;
        character.status = 'ready';
        await saveDb();
        
        // If premium, trigger new dataset and LoRA
        if (isPremium && character.loraId) {
          // Re-use same loraId, but wipe its state
          const loraMetadata = MOCK_LORAS[character.loraId];
          if (loraMetadata) {
            loraMetadata.status = 'generating_dataset';
            loraMetadata.datasetUrls = [];
            loraMetadata.safetensorsUrl = undefined;
            await saveDb();
            
            try {
              console.log(`[LoRA] Sending single character sheet for ${character.name} to worker for cropping...`);
              if (character.imageUrl) {
                loraMetadata.datasetUrls = [character.imageUrl];
              }

              loraMetadata.status = 'training';
              await saveDb();
              console.log(`[LoRA] Dispatching re-training job for ${character.name}...`);
              const safetensorsUrl = await provider.trainLora(character.loraId!, loraMetadata.triggerToken, loraMetadata.datasetUrls);
              
              if (safetensorsUrl) {
                loraMetadata.safetensorsUrl = safetensorsUrl;
                loraMetadata.status = 'completed';
                console.log(`[LoRA] ✅ Re-training complete for ${character.name}!`);
                await saveDb();
              } else {
                throw new Error('No URL returned from training');
              }
            } catch (err: any) {
              console.error(`[LoRA] ❌ Pipeline failed for ${character.name}:`, err.message);
              loraMetadata.status = 'failed';
              await saveDb();
            }
          }
        }
      } catch (err: any) {
        console.error(`[Characters] ❌ Async regenerate failed for ${character.name}:`, err);
        character.status = 'ready'; // fallback
        await saveDb();
      }
    })();
  } catch (error: any) {
    console.error(`[Characters] Failed to setup regeneration:`, error);
    return res.status(500).json({ error: 'Failed to regenerate character', details: error.message });
  }
});

app.delete('/api/v1/characters/:character_id', async (req: Request, res: Response) => {
  const { character_id } = req.params;
  const character = MOCK_CHARACTERS[character_id];
  
  if (!character) {
    return res.status(404).json({ error: 'Character not found' });
  }

  // Clean up associated LoRA metadata
  if (character.loraId && MOCK_LORAS[character.loraId]) {
    delete MOCK_LORAS[character.loraId];
    console.log(`[Characters] Deleted LoRA metadata: ${character.loraId}`);
  }

  delete MOCK_CHARACTERS[character_id];
  console.log(`[Characters] Deleted character: ${character.name} (${character_id})`);
  
  await saveDb();
  return res.json({ success: true, message: `Character '${character.name}' deleted` });
});

// Global Activity & Notifications endpoint — polled by frontend for the notification bar
app.get('/api/v1/activity', (req: Request, res: Response) => {
  const activities: any[] = [];

  // LoRA training activities
  for (const lora of Object.values(MOCK_LORAS)) {
    if (['generating_dataset', 'training'].includes(lora.status)) {
      const char = MOCK_CHARACTERS[lora.characterId];
      activities.push({
        id: lora.id,
        type: 'lora_training',
        status: lora.status,
        characterName: char?.name || 'Unknown',
        message: lora.status === 'generating_dataset' 
          ? `Generating training images for ${char?.name}...`
          : `Training LoRA for ${char?.name}...`,
      });
    }
  }

  // Completed LoRA notifications (last 5 minutes)
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  for (const lora of Object.values(MOCK_LORAS)) {
    if (lora.status === 'completed' && new Date(lora.createdAt).getTime() > fiveMinAgo) {
      const char = MOCK_CHARACTERS[lora.characterId];
      activities.push({
        id: lora.id,
        type: 'lora_complete',
        status: 'completed',
        characterName: char?.name || 'Unknown',
        message: `LoRA training complete for ${char?.name}! Ready to use.`,
      });
    }
  }

  // Active story rendering
  for (const story of Object.values(MOCK_STORIES)) {
    if (['generating_board', 'generating_video'].includes(story.status)) {
      activities.push({
        id: story.id,
        type: 'story_rendering',
        status: story.status,
        message: story.status === 'generating_board'
          ? `Planning storyboard for "${story.title.substring(0, 40)}..."`
          : `Rendering video for "${story.title.substring(0, 40)}..."`,
      });
    }
  }

  return res.json({ activities });
});

// ---------------------------------------------------------------------------
// Story Mode Endpoints
// ---------------------------------------------------------------------------

app.post('/api/v1/stories', async (req: Request, res: Response) => {
  const { title, genre, visualStyle, targetDuration, castIds, videoEngine, includeAudio, audioPrompt } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const storyId = crypto.randomUUID();
  const newStory: Story = {
    id: storyId,
    title,
    genre: genre || 'Cinematic',
    visualStyle: visualStyle || 'Cinematic',
    targetDuration: targetDuration || 15,
    videoEngine: videoEngine || 'wan',
    includeAudio: includeAudio || false,
    audioPrompt: audioPrompt || '',
    castIds: castIds || [],
    status: 'draft',
    scenes: [],
    createdAt: new Date().toISOString()
  };

  MOCK_STORIES[storyId] = newStory;
  await saveDb();
  return res.status(201).json(newStory);
});

app.get('/api/v1/stories', (req: Request, res: Response) => {
  const stories = Object.values(MOCK_STORIES).sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return res.json({ stories });
});

app.get('/api/v1/stories/:story_id', (req: Request, res: Response) => {
  const { story_id } = req.params;
  const story = MOCK_STORIES[story_id];
  if (!story) return res.status(404).json({ error: 'Story not found' });
  return res.json(story);
});

app.post('/api/v1/stories/:story_id/generate-board', async (req: Request, res: Response) => {
  const { story_id } = req.params;
  const { castIds } = req.body;
  const story = MOCK_STORIES[story_id];
  if (!story) return res.status(404).json({ error: 'Story not found' });

  if (castIds && Array.isArray(castIds)) {
    story.castIds = castIds;
  }

  // Check if any cast member's LoRA is currently training
  if (story.castIds && story.castIds.length > 0) {
    for (const cid of story.castIds) {
      const char = MOCK_CHARACTERS[cid];
      if (char && char.loraId && MOCK_LORAS[char.loraId]) {
        const status = MOCK_LORAS[char.loraId].status;
        if (status === 'generating_dataset' || status === 'training') {
          return res.status(400).json({ 
            error: 'Character still training', 
            details: `Cannot use character '${char.name}' because its Premium LoRA model is still training. Please wait.`
          });
        }
      }
    }
  }

  await saveDb();
  // Return immediately since planning can take 5-10s via LLM
  res.status(202).json({ success: true, message: 'Generating storyboard...' });

  let primaryCharacterUrl: string | null = null;
  let characterContext = '';
  
  if (story.castIds && story.castIds.length > 0) {
    const mainChar = MOCK_CHARACTERS[story.castIds[0]];
    if (mainChar) {
       primaryCharacterUrl = mainChar.imageUrl;
       // Make the character context extremely descriptive and rigid so Flux doesn't hallucinate
       characterContext = `(Masterpiece, best quality, highly detailed). Main subject: ${mainChar.name}. Appearance: ${mainChar.appearance}. Outfit: ${mainChar.outfit}. `;
    }
  }

  const provider = new MockVideoProvider();
  const orchestrator = new NovaSceneOrchestrator(provider);
  const prompt = `${story.title}. Genre: ${story.genre}. ${characterContext}`;

  try {
    console.log(`[Stories] Generating board for ${story.id}...`);
    const orchestratorResult = await orchestrator.splitPromptIntoScenes(prompt, story.targetDuration, story.visualStyle);
    
    // Auto-fill the audio prompt if requested
    if (story.includeAudio && orchestratorResult.audioPrompt) {
      story.audioPrompt = orchestratorResult.audioPrompt;
    }
    
    story.scenes = orchestratorResult.scenes.map((s: any) => {
      // Programmatically enforce the exact character description on every single prompt
      // Put the action FIRST so that the 77-token CLIP limit doesn't truncate the core action!
      const finalPrompt = characterContext ? `Action: ${s.prompt} | Character details: ${characterContext}` : s.prompt;
      
      return {
        id: `scene-${s.sceneIndex}-${crypto.randomUUID()}`,
        index: s.sceneIndex,
        prompt: finalPrompt,
        duration: s.duration,
        status: 'pending',
      // Don't inject the multi-panel character sheet — it's a composite reference
      // image (front/side/3-4 views) that would produce weird I2V results.
      // Instead, let Flux generate a scene-specific keyframe per scene.
      // Character consistency is maintained via the LoRA trigger token.
        imageUrl: null 
      };
    });

    story.status = 'board_ready';
    console.log(`[Stories] Board generated for ${story.id} with ${story.scenes.length} scenes.`);
    await saveDb();
  } catch (error) {
    console.error(`[Stories] Failed to generate board:`, error);
    story.status = 'failed';
    await saveDb();
  }
});

// Delete a story
app.delete('/api/v1/stories/:story_id', async (req: Request, res: Response) => {
  const { story_id } = req.params;
  
  if (!MOCK_STORIES[story_id]) {
    return res.status(404).json({ error: 'Story not found' });
  }
  
  delete MOCK_STORIES[story_id];
  await saveDb();
  res.status(200).json({ success: true });
});

// Delete a scene from a story
app.delete('/api/v1/stories/:story_id/scenes/:scene_id', async (req: Request, res: Response) => {
  const { story_id, scene_id } = req.params;
  
  const story = MOCK_STORIES[story_id];
  if (!story) {
    return res.status(404).json({ error: 'Story not found' });
  }
  
  const initialLength = story.scenes.length;
  story.scenes = story.scenes.filter(s => s.id !== scene_id);
  
  if (story.scenes.length === initialLength) {
    return res.status(404).json({ error: 'Scene not found in story' });
  }
  
  await saveDb();
  res.status(200).json({ success: true, scenes: story.scenes });
});

// We can just reuse simulateJobRenderPhase logic or create a similar one for Stories
app.post('/api/v1/stories/:story_id/render', async (req: Request, res: Response) => {
  const { story_id } = req.params;
  const story = MOCK_STORIES[story_id];
  if (!story) return res.status(404).json({ error: 'Story not found' });

  if (story.status !== 'board_ready' && story.status !== 'failed') {
    return res.status(400).json({ error: 'Storyboard is not ready or has not failed' });
  }

  // Allow the UI to override scenes (for edited prompts) and audio prompt before rendering
  if (req.body.scenes && Array.isArray(req.body.scenes)) {
    story.scenes = req.body.scenes;
  }
  if (req.body.audioPrompt !== undefined) {
    story.audioPrompt = req.body.audioPrompt;
  }

  story.status = 'generating_video';
  await saveDb();
  res.status(202).json({ success: true, message: 'Rendering story video...' });

  // Async render
  const apiKey = process.env.RUNPOD_API_KEY;
  const isMock = !apiKey || apiKey === 'mock-runpod-key';
  
  let provider: any;
  if (isMock) {
    provider = new MockVideoProvider();
  } else {
    provider = new RunPodVideoProvider({
      apiKey: apiKey!,
      fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID || '',
      wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID || '',
      ltxEndpointId: process.env.RUNPOD_LTX_ENDPOINT_ID || '',
      audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID || '',
      loraEndpointId: process.env.RUNPOD_LORA_ENDPOINT_ID || '',
    });
  }

  const orchestrator = new NovaSceneOrchestrator(provider);
  
  try {
    console.log(`[Stories] Triggering render for story ${story.id}. videoEngine is: ${story.videoEngine}`);
    
    // Check if the primary cast member has a trained LoRA
    if (story.castIds && story.castIds.length > 0) {
      const primaryChar = MOCK_CHARACTERS[story.castIds[0]];
      if (primaryChar && primaryChar.loraId) {
        const lora = MOCK_LORAS[primaryChar.loraId];
        if (lora && lora.status === 'completed' && lora.safetensorsUrl) {
           console.log(`[Stories] Primary character has completed LoRA. Injecting into all scenes!`);
           story.scenes.forEach(scene => {
             scene.loraSafetensorsUrl = lora.safetensorsUrl;
             scene.loraTriggerToken = lora.triggerToken;
           });
        }
      }
    }
    
    const { finalVideoUrl, generatedAudioUrl, generatedVoiceoverUrl } = await orchestrator.executeJobRenderPhase(
      story.id,
      story.scenes,
      !!story.includeAudio,
      story.audioPrompt || "",
      story.videoEngine || 'wan',
      story.generatedAudioUrl,
      story.generatedVoiceoverUrl,
      (update: any) => {
         // Could emit SSE for stories here, skipping for brevity
         if (update.scenes) {
             update.scenes.forEach((us: any) => {
               const ls = story.scenes.find(s => s.index === us.index);
               if (ls) {
                 ls.status = us.status;
                 ls.videoUrl = us.videoUrl;
               }
             });
         }
      }
    );

    story.finalVideoUrl = finalVideoUrl;
    if (generatedAudioUrl) story.generatedAudioUrl = generatedAudioUrl;
    if (generatedVoiceoverUrl) story.generatedVoiceoverUrl = generatedVoiceoverUrl;
    
    story.status = 'completed';
    console.log(`[Stories] Story ${story.id} render completed! URL: ${story.finalVideoUrl}`);
    await saveDb();
  } catch (err) {
    console.error(`[Stories] Story render failed:`, err);
    story.status = 'failed';
    await saveDb();
  }
});

export default app;
