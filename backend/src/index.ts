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
}

interface LoraMetadata {
  id: string;
  characterId: string;
  version: number;
  triggerToken: string;
  datasetUrls: string[];
  status: 'generating_dataset' | 'training' | 'completed' | 'failed';
  safetensorsUrl?: string;
  createdAt: string;
}

import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'db.json');

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
  createdAt: string;
}

const MOCK_STORIES: Record<string, Story> = {};

// Load database from disk on startup
if (fs.existsSync(DB_PATH)) {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    Object.assign(MOCK_JOBS, data.jobs || {});
    Object.assign(MOCK_CHARACTERS, data.characters || {});
    Object.assign(MOCK_STORIES, data.stories || {});
    Object.assign(MOCK_LORAS, data.loras || {});
    console.log(`[DB] Loaded persistent mock database from ${DB_PATH}`);
  } catch (e) {
    console.error(`[DB] Error loading mock database`, e);
  }
}

// Save database to disk periodically
function saveDb() {
  const data = {
    jobs: MOCK_JOBS,
    characters: MOCK_CHARACTERS,
    stories: MOCK_STORIES,
    loras: MOCK_LORAS
  };
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
setInterval(saveDb, 2000);

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
async function simulateJobPlanningPhase(jobId: string, prompt: string, duration: number = 15, visualStyle: string = "Cinematic") {
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
    const scenes = await orchestrator.splitPromptIntoScenes(prompt, duration, visualStyle);
    
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
  simulateJobPlanningPhase(jobId, prompt, duration, style);

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

app.post('/api/v1/characters', async (req: Request, res: Response) => {
  const { name, gender, appearance, outfit, visualStyle } = req.body;
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
    createdAt: new Date().toISOString()
  };

  MOCK_CHARACTERS[characterId] = newCharacter;

  // Initialize Provider to generate the canonical character image
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey || apiKey === 'mock-runpod-key') {
     console.log(`[Characters] Mocking character generation for ${name}...`);
     newCharacter.imageUrl = "https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev/keyframes/keyframe_mock.jpg";
     return res.status(201).json(newCharacter);
  }

  try {
    const provider = new RunPodVideoProvider({
      apiKey: apiKey,
      fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID || '',
      wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID || '',
      ltxEndpointId: process.env.RUNPOD_LTX_ENDPOINT_ID || '',
      audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID || '',
    });

    // The core magic: We generate a highly detailed prompt specifically designed to yield a perfect character sheet
    const prompt = `A professional multi-angle character reference sheet of a character, ${visualStyle}. ${appearance}. Wearing: ${outfit}. The image must contain three separate views of the exact same character side-by-side: a front view, a side profile view, and a 3/4 angle view. Neutral expression, plain white studio background. Highly detailed, consistent character design across all angles.`;
    
    console.log(`[Characters] Generating canonical multi-angle character sheet for ${name} using Flux...`);
    // Pass 16:9 aspect ratio to fit the multi-angle views side-by-side
    const imageUrl = await provider.generateImage(prompt, '16:9');
    
    newCharacter.imageUrl = imageUrl;
    MOCK_CHARACTERS[characterId] = newCharacter;
    
    return res.status(201).json(newCharacter);
  } catch (error: any) {
    console.error(`[Characters] Failed to generate character image:`, error);
    return res.status(500).json({ error: 'Failed to generate character image', details: error.message });
  }
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
  
  res.status(202).json({ success: true, message: 'Dataset generation started', loraId });

  // Start background generation
  try {
    const provider = new RunPodVideoProvider({
      apiKey: process.env.RUNPOD_API_KEY || '',
      fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID || '',
      wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID || '',
      ltxEndpointId: process.env.RUNPOD_LTX_ENDPOINT_ID || '',
      audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID || '',
    });

    const datasetPrompts = [
      `A close-up portrait of ${character.appearance}. Wearing: ${character.outfit}. Neutral expression, looking directly at the camera, plain white background, highly detailed.`,
      `A side profile view of ${character.appearance}. Wearing: ${character.outfit}. Looking to the right, plain white background, highly detailed.`,
      `A 3/4 angle view of ${character.appearance}. Wearing: ${character.outfit}. Looking slightly away, plain white background, highly detailed.`,
      `A medium shot of ${character.appearance}. Wearing: ${character.outfit}. Laughing happily, plain white background, highly detailed.`,
      `A close-up of ${character.appearance}. Wearing: ${character.outfit}. Sad expression, looking down, plain white background, highly detailed.`,
      `A full body shot of ${character.appearance}. Wearing: ${character.outfit}. Standing in a heroic pose, plain white background, highly detailed.`,
      `A medium shot of ${character.appearance}. Wearing: ${character.outfit}. Angry expression, plain white background, highly detailed.`,
      `A portrait of ${character.appearance}. Wearing: ${character.outfit}. Looking up in awe, plain white background, highly detailed.`
    ];

    console.log(`[LoRA] Starting dataset generation for character ${id} (${datasetPrompts.length} images)...`);
    
    // Generate images sequentially to avoid overloading the RunPod serverless queue or hitting rate limits
    for (const p of datasetPrompts) {
       const url = await provider.generateImage(p, '1:1');
       loraMetadata.datasetUrls.push(url);
       console.log(`[LoRA] Generated dataset image ${loraMetadata.datasetUrls.length}/${datasetPrompts.length}`);
    }
    
    loraMetadata.status = 'training'; // Ready for next step
    console.log(`[LoRA] Dataset generation complete! LoRA ${loraId} is ready for training.`);
    
    console.log(`[LoRA] Dispatching training job to LoRA endpoint...`);
    const safetensorsUrl = await provider.trainLora(loraId, loraMetadata.triggerToken, loraMetadata.datasetUrls);
    
    if (safetensorsUrl) {
      loraMetadata.safetensorsUrl = safetensorsUrl;
      loraMetadata.status = 'completed';
      console.log(`[LoRA] Training complete! LoRA URL: ${safetensorsUrl}`);
    } else {
      throw new Error("No URL returned from training");
    }
    
  } catch (err) {
    console.error(`[LoRA] Dataset generation failed:`, err);
    loraMetadata.status = 'failed';
  }
});

app.get('/api/v1/characters', (req: Request, res: Response) => {
  const characters = Object.values(MOCK_CHARACTERS).sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return res.json({ characters });
});

// ---------------------------------------------------------------------------
// Story Mode Endpoints
// ---------------------------------------------------------------------------

app.post('/api/v1/stories', (req: Request, res: Response) => {
  const { title, genre, visualStyle, targetDuration, castIds, videoEngine } = req.body;
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
    castIds: castIds || [],
    status: 'draft',
    scenes: [],
    createdAt: new Date().toISOString()
  };

  MOCK_STORIES[storyId] = newStory;
  return res.status(201).json(newStory);
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

  story.status = 'generating_board';
  
  // Return immediately since planning can take 5-10s via LLM
  res.status(202).json({ success: true, message: 'Generating storyboard...' });

  let primaryCharacterUrl: string | null = null;
  let characterContext = '';
  
  if (story.castIds && story.castIds.length > 0) {
    const mainChar = MOCK_CHARACTERS[story.castIds[0]];
    if (mainChar) {
       primaryCharacterUrl = mainChar.imageUrl;
       characterContext = `The main character is ${mainChar.name}. Appearance: ${mainChar.appearance}. Wearing: ${mainChar.outfit}. `;
    }
  }

  const provider = new MockVideoProvider();
  const orchestrator = new NovaSceneOrchestrator(provider);
  const prompt = `${story.title}. Genre: ${story.genre}. ${characterContext}`;

  try {
    console.log(`[Stories] Generating board for ${story.id}...`);
    const scenes = await orchestrator.splitPromptIntoScenes(prompt, story.targetDuration, story.visualStyle);
    
    story.scenes = scenes.map((s) => ({
      id: `scene-${s.sceneIndex}-${crypto.randomUUID()}`,
      index: s.sceneIndex,
      prompt: s.prompt,
      duration: s.duration,
      status: 'pending',
      // PRE-INJECT THE CHARACTER ASSET! THIS BYPASSES FLUX TEXT-TO-IMAGE FOR THIS SCENE
      imageUrl: primaryCharacterUrl 
    }));

    story.status = 'board_ready';
    console.log(`[Stories] Board generated for ${story.id} with ${story.scenes.length} scenes.`);
  } catch (error) {
    console.error(`[Stories] Failed to generate board:`, error);
    story.status = 'failed';
  }
});

// We can just reuse simulateJobRenderPhase logic or create a similar one for Stories
app.post('/api/v1/stories/:story_id/render', async (req: Request, res: Response) => {
  const { story_id } = req.params;
  const story = MOCK_STORIES[story_id];
  if (!story) return res.status(404).json({ error: 'Story not found' });

  if (story.status !== 'board_ready') {
    return res.status(400).json({ error: 'Storyboard is not ready' });
  }

  story.status = 'generating_video';
  res.status(202).json({ success: true, message: 'Rendering story video...' });

  // Async render
  const apiKey = process.env.RUNPOD_API_KEY;
  const isMock = !apiKey || apiKey === 'mock-runpod-key';
  
  let provider;
  if (isMock) {
    provider = new MockVideoProvider();
  } else {
    provider = new RunPodVideoProvider({
      apiKey: apiKey!,
      fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID || '',
      wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID || '',
      ltxEndpointId: process.env.RUNPOD_LTX_ENDPOINT_ID || '',
      audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID || '',
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
    
    const finalVideoUrl = await orchestrator.executeJobRenderPhase(
      story.id,
      story.scenes,
      true, // Include audio by default for stories
      `Epic cinematic soundtrack for ${story.genre}`,
      story.videoEngine || 'wan',
      (update) => {
         // Could emit SSE for stories here, skipping for brevity
         if (update.scenes) {
             update.scenes.forEach(us => {
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
    story.status = 'completed';
    console.log(`[Stories] Story ${story.id} render completed! URL: ${finalVideoUrl}`);
  } catch (err) {
    console.error(`[Stories] Story render failed:`, err);
    story.status = 'failed';
  }
});

export default app;
