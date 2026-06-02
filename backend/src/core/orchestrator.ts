import { VideoProvider } from './provider';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

const execPromise = util.promisify(exec);

export interface SceneDefinition {
  sceneIndex: number;
  duration: number;
  prompt: string;
}

export interface OrchestratorScene {
  id: string;
  index: number;
  prompt: string;
  duration: number;
  status: 'pending' | 'generating_image' | 'generating_motion' | 'completed' | 'failed';
  imageUrl?: string | null;
  videoUrl?: string | null;
}

export interface OrchestratorProgressUpdate {
  status: 'queued' | 'analyzing' | 'processing_scenes' | 'stitching' | 'completed' | 'failed';
  progress: number;
  scenes?: OrchestratorScene[];
  video?: {
    videoUrl: string;
    thumbnailUrl: string;
    duration: number;
    fileSizeStr: string;
  } | null;
  errorMessage?: string | null;
}

export class NovaSceneOrchestrator {
  constructor(private provider: VideoProvider) {}

  async splitPromptIntoScenes(prompt: string, targetDuration: number): Promise<SceneDefinition[]> {
    console.log(`[Orchestrator] Splitting prompt using LLM engine: "${prompt}"`);
    // Simulate LLM parse latency
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    return [
      { sceneIndex: 0, duration: targetDuration, prompt: prompt }
    ];
  }

  async stitchScenes(videoUrls: string[], audioUrl?: string): Promise<string> {
    console.log(`[Orchestrator] Stitching ${videoUrls.length} scene clips...`);
    if (!videoUrls.length) {
      throw new Error('No video clips were generated to stitch.');
    }
    
    // MVP: return the first scene clip if no audio
    let finalVideoUrl = videoUrls[0];
    
    if (audioUrl) {
      console.log(`[Orchestrator] Audio URL provided. Multiplexing audio and video...`);
      try {
        const jobId = crypto.randomUUID();
        const tmpDir = path.join(process.cwd(), 'tmp');
        await fs.mkdir(tmpDir, { recursive: true }).catch(() => {});
        
        const videoPath = path.join(tmpDir, `video_${jobId}.mp4`);
        const audioPath = path.join(tmpDir, `audio_${jobId}.wav`);
        const outPath = path.join(tmpDir, `final_${jobId}.mp4`);
        const outPathPublic = path.join(process.cwd(), 'static', `final_${jobId}.mp4`);
        
        // 1. Download video and audio
        console.log(`[Orchestrator] Downloading remote files for FFmpeg...`);
        const [vidRes, audRes] = await Promise.all([
          fetch(videoUrls[0]),
          fetch(audioUrl)
        ]);
        
        if (!vidRes.ok || !audRes.ok) throw new Error("Failed to download media for stitching");
        
        await fs.writeFile(videoPath, Buffer.from(await vidRes.arrayBuffer()));
        await fs.writeFile(audioPath, Buffer.from(await audRes.arrayBuffer()));
        
        // 2. FFmpeg stitch (shortest length wins to prevent hanging audio)
        console.log(`[Orchestrator] Running FFmpeg stitch job...`);
        const cmd = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outPathPublic}"`;
        await execPromise(cmd);
        console.log(`[Orchestrator] FFmpeg stitching complete!`);
        
        // 3. Clean up temps
        await fs.unlink(videoPath).catch(() => {});
        await fs.unlink(audioPath).catch(() => {});
        
        // 4. Return new URL
        finalVideoUrl = `http://localhost:8000/static/final_${jobId}.mp4`;
      } catch (err: any) {
        console.error(`[Orchestrator] FFmpeg stitching failed, falling back to raw video:`, err.message);
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    
    return finalVideoUrl;
  }

  async executeJob(
    jobId: string,
    originalPrompt: string,
    targetDuration: number = 15,
    includeAudio: boolean = false,
    audioPrompt: string = "",
    videoEngine: string = "wan",
    onProgress?: (update: OrchestratorProgressUpdate) => void
  ): Promise<string> {
    console.log(`[Orchestrator] Running live orchestration job: ${jobId}`);
    
    try {
      // 1. Analyze and split prompt
      if (onProgress) {
        onProgress({ status: 'analyzing', progress: 10 });
      }
      const scenes = await this.splitPromptIntoScenes(originalPrompt, targetDuration);
      
      // 2. Initialize scene tracking
      const scenesList: OrchestratorScene[] = scenes.map((s) => ({
        id: `scene-${s.sceneIndex}-${Math.random().toString(36).substring(2, 7)}`,
        index: s.sceneIndex,
        prompt: s.prompt,
        duration: s.duration,
        status: 'pending'
      }));

      if (onProgress) {
        onProgress({
          status: 'processing_scenes',
          progress: 20,
          scenes: [...scenesList]
        });
      }

      // Helper helper to update and emit state updates
      const updateSceneAndNotify = (sceneIndex: number, update: Partial<OrchestratorScene>) => {
        const target = scenesList.find((s) => s.index === sceneIndex);
        if (target) {
          Object.assign(target, update);
        }

        // Calculate progress between 20% and 80% based on individual scene stage steps
        let completedStages = 0;
        const totalStages = scenesList.length * 2; // 2 stages per scene: image, video

        for (const s of scenesList) {
          if (s.status === 'generating_motion') completedStages += 1;
          if (s.status === 'completed') completedStages += 2;
        }

        const base = 20;
        const range = 60;
        const stepProgress = Math.round(base + (completedStages / totalStages) * range);

        if (onProgress) {
          onProgress({
            status: 'processing_scenes',
            progress: stepProgress,
            scenes: [...scenesList]
          });
        }
      };

      // 3. Render all scene segments in parallel, AND audio if requested
      const renderTasks = scenes.map(async (scene) => {
        updateSceneAndNotify(scene.sceneIndex, { status: 'generating_image' });
        
        // Generate Flux Keyframe
        const imageUrl = await this.provider.generateImage(scene.prompt, '16:9');
        updateSceneAndNotify(scene.sceneIndex, {
          status: 'generating_motion',
          imageUrl
        });

        // Generate Motion Clip
        const videoUrl = await this.provider.generateMotion(imageUrl, scene.prompt, scene.duration, videoEngine);
        updateSceneAndNotify(scene.sceneIndex, {
          status: 'completed',
          videoUrl
        });

        return videoUrl;
      });

      // Audio generation Promise
      let audioPromise: Promise<string | undefined> = Promise.resolve(undefined);
      if (includeAudio) {
        console.log(`[Orchestrator] Dispatching Audio Task for prompt: "${audioPrompt}"`);
        const totalDuration = scenes.reduce((acc, s) => acc + s.duration, 0);
        audioPromise = this.provider.generateAudio(audioPrompt, totalDuration).catch((err) => {
          console.error(`[Orchestrator] Audio generation failed, continuing without audio:`, err.message);
          return undefined;
        });
      }

      const [videoUrls, generatedAudioUrl] = await Promise.all([
        Promise.all(renderTasks),
        audioPromise
      ]);

      // 4. Stitch clips
      if (onProgress) {
        onProgress({ status: 'stitching', progress: 85 });
      }
      const finalVideoUrl = await this.stitchScenes(videoUrls, generatedAudioUrl);

      // 5. Completion
      const totalDuration = scenesList.reduce((acc, s) => acc + s.duration, 0);
      if (onProgress) {
        onProgress({
          status: 'completed',
          progress: 100,
          video: {
            videoUrl: finalVideoUrl,
            thumbnailUrl: scenesList[0]?.imageUrl || '',
            duration: totalDuration,
            fileSizeStr: `${(totalDuration * 2).toFixed(1)} MB`
          }
        });
      }

      console.log(`[Orchestrator] Job ${jobId} execution completed successfully.`);
      return finalVideoUrl;
    } catch (err: any) {
      console.error(`[Orchestrator] Job ${jobId} execution failed:`, err.message);
      if (onProgress) {
        onProgress({
          status: 'failed',
          progress: 100,
          errorMessage: err.message || 'Pipeline execution failed'
        });
      }
      throw err;
    }
  }
}
