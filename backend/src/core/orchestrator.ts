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
    console.log(`[Orchestrator] Splitting prompt using LLM Director: "${prompt}"`);
    
    const maxChunkDuration = 5;
    const numScenes = Math.ceil(targetDuration / maxChunkDuration);
    const scenes: SceneDefinition[] = [];
    
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      console.log(`[Orchestrator] OpenAI API Key found, calling GPT-4o...`);
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              { 
                role: "system", 
                content: `You are an expert cinematic AI video director. The user will provide a master prompt for a video sequence. Your job is to break it down into ${numScenes} distinct scenes. Each scene prompt MUST focus on a different aspect of the story or use a different camera angle (e.g. establishing shot, close up, tracking shot) to create a dynamic cinematic montage. Ensure the character/subject description remains highly consistent across all prompts. Return a JSON object with a single key "scenes" containing an array of exactly ${numScenes} strings.`
              },
              { role: "user", content: `Master prompt: ${prompt}` }
            ],
            response_format: { type: "json_object" }
          })
        });

        if (response.ok) {
          const data: any = await response.json();
          const parsed = JSON.parse(data.choices[0].message.content);
          if (parsed.scenes && Array.isArray(parsed.scenes)) {
            console.log(`[Orchestrator] Successfully generated ${parsed.scenes.length} distinct scenes via OpenAI.`);
            let remaining = targetDuration;
            for (let i = 0; i < numScenes; i++) {
              const chunk = Math.min(maxChunkDuration, remaining);
              scenes.push({
                sceneIndex: i,
                duration: chunk,
                prompt: parsed.scenes[i] || `${prompt} (Scene ${i+1})`
              });
              remaining -= chunk;
            }
            return scenes;
          }
        } else {
          console.error("[Orchestrator] OpenAI API error:", await response.text());
        }
      } catch (err: any) {
        console.error("[Orchestrator] OpenAI LLM failed:", err.message);
      }
    } else {
      console.log(`[Orchestrator] No OPENAI_API_KEY found, falling back to rule-based generation.`);
    }
    
    // Fallback logic
    console.log(`[Orchestrator] Using rule-based fallback...`);
    let remaining = targetDuration;
    let index = 0;
    
    const cameraAngles = [
      "Wide establishing shot, cinematic composition. ",
      "Medium shot, dynamic camera movement. ",
      "Close up, detailed focus on the subject. ",
      "Tracking shot, smooth motion. "
    ];
    
    while (remaining > 0) {
      const chunk = Math.min(maxChunkDuration, remaining);
      const anglePrefix = cameraAngles[index % cameraAngles.length];
      scenes.push({
        sceneIndex: index,
        duration: chunk,
        prompt: `${anglePrefix}${prompt}`
      });
      remaining -= chunk;
      index++;
    }
    
    return scenes;
  }

  async stitchScenes(videoUrls: string[], audioUrl?: string): Promise<string> {
    console.log(`[Orchestrator] Stitching ${videoUrls.length} scene clips...`);
    if (!videoUrls.length) {
      throw new Error('No video clips were generated to stitch.');
    }
    
    const jobId = crypto.randomUUID();
    const tmpDir = path.join(process.cwd(), 'tmp');
    await fs.mkdir(tmpDir, { recursive: true }).catch(() => {});
    
    const outPathPublic = path.join(process.cwd(), 'static', `final_${jobId}.mp4`);
    let finalVideoUrl = videoUrls[0];
    let concatenatedVideoPath = '';
    
    try {
      // 1. Download all video chunks
      const localVideoPaths: string[] = [];
      for (let i = 0; i < videoUrls.length; i++) {
        const vidRes = await fetch(videoUrls[i]);
        if (!vidRes.ok) throw new Error(`Failed to download video chunk ${i}`);
        const p = path.join(tmpDir, `chunk_${jobId}_${i}.mp4`);
        await fs.writeFile(p, Buffer.from(await vidRes.arrayBuffer()));
        localVideoPaths.push(p);
      }
      
      // 2. Concatenate video chunks if more than 1
      if (localVideoPaths.length > 1) {
        concatenatedVideoPath = path.join(tmpDir, `concat_${jobId}.mp4`);
        const listPath = path.join(tmpDir, `list_${jobId}.txt`);
        const listContent = localVideoPaths.map(p => `file '${p}'`).join('\n');
        await fs.writeFile(listPath, listContent);
        
        console.log(`[Orchestrator] Running FFmpeg concat on ${localVideoPaths.length} clips...`);
        const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${concatenatedVideoPath}"`;
        await execPromise(concatCmd);
        await fs.unlink(listPath).catch(() => {});
      } else {
        concatenatedVideoPath = localVideoPaths[0];
      }
      
      // 3. Multiplex Audio if provided
      if (audioUrl) {
        console.log(`[Orchestrator] Audio URL provided. Multiplexing audio and video...`);
        const audioPath = path.join(tmpDir, `audio_${jobId}.wav`);
        const audRes = await fetch(audioUrl);
        if (!audRes.ok) throw new Error("Failed to download audio for stitching");
        await fs.writeFile(audioPath, Buffer.from(await audRes.arrayBuffer()));
        
        console.log(`[Orchestrator] Running FFmpeg audio mix job...`);
        const mixCmd = `ffmpeg -y -i "${concatenatedVideoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outPathPublic}"`;
        await execPromise(mixCmd);
        await fs.unlink(audioPath).catch(() => {});
      } else {
        // Just move the concatenated video to public directory
        await fs.rename(concatenatedVideoPath, outPathPublic).catch(async () => {
            await fs.copyFile(concatenatedVideoPath, outPathPublic);
        });
      }
      
      finalVideoUrl = `http://localhost:8000/static/final_${jobId}.mp4`;
      
      // 4. Cleanup temp files
      for (const p of localVideoPaths) {
        await fs.unlink(p).catch(() => {});
      }
      if (localVideoPaths.length > 1) {
        await fs.unlink(concatenatedVideoPath).catch(() => {});
      }
      
    } catch (err: any) {
      console.error(`[Orchestrator] FFmpeg stitching failed, falling back to raw video:`, err.message);
    }
    
    return finalVideoUrl;
  }

  async executeJobRenderPhase(
    jobId: string,
    scenesList: OrchestratorScene[],
    includeAudio: boolean = false,
    audioPrompt: string = "",
    videoEngine: string = "wan",
    onProgress?: (update: OrchestratorProgressUpdate) => void
  ): Promise<string> {
    console.log(`[Orchestrator] Starting render phase for job: ${jobId}`);
    
    try {
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
      const renderTasks = scenesList.map(async (scene) => {
        updateSceneAndNotify(scene.index, { status: 'generating_image' });
        
        // Generate Flux Keyframe
        const imageUrl = await this.provider.generateImage(scene.prompt, '16:9');
        updateSceneAndNotify(scene.index, {
          status: 'generating_motion',
          imageUrl
        });

        // Generate Motion Clip
        const videoUrl = await this.provider.generateMotion(imageUrl, scene.prompt, scene.duration, videoEngine);
        updateSceneAndNotify(scene.index, {
          status: 'completed',
          videoUrl
        });

        return videoUrl;
      });

      // Audio generation Promise
      let audioPromise: Promise<string | undefined> = Promise.resolve(undefined);
      if (includeAudio) {
        console.log(`[Orchestrator] Dispatching Audio Task for prompt: "${audioPrompt}"`);
        const totalDuration = scenesList.reduce((acc, s) => acc + s.duration, 0);
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
