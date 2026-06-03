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
  narration?: string;
}

export interface OrchestratorScene {
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

  async splitPromptIntoScenes(prompt: string, targetDuration: number, visualStyle: string = "Cinematic"): Promise<SceneDefinition[]> {
    console.log(`[Orchestrator] Splitting prompt using LLM Director: "${prompt}" (Style: ${visualStyle})`);
    
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
                content: `You are an expert cinematic AI video director and storyteller. The user will provide a master prompt for a video sequence of exactly ${targetDuration} seconds. Your job is to break it down into a sequence of distinct cut scenes.
Rules:
1. Each scene MUST have a duration between 2 and 5 seconds (MAXIMUM 5 seconds due to GPU memory limits).
2. The total sum of all scene durations MUST exactly equal ${targetDuration} seconds.
3. The user has selected the visual style: "${visualStyle}". You MUST explicitly prepend the exact visual style AND the full, detailed character/subject description to EVERY SINGLE SCENE PROMPT you generate.
4. DO NOT omit character details in subsequent scenes. Every scene prompt must be a fully standalone description capable of generating the exact same character in the exact same style.
5. For each scene, also write a "narration" field: a short voiceover narration line for that scene. This is what a narrator would say over the video. Write the narration in the SAME LANGUAGE as the user's master prompt. If the user writes in Hindi, narrate in Hindi. If English, narrate in English.
6. The narration should tell a story, not describe camera angles. It should be emotional, immersive, and cinematic.
Return a JSON object with a single key "scenes" containing an array of objects, where each object has "duration" (number), "prompt" (string), and "narration" (string).`
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
            
            // Validate and map the scenes
            let runningTotal = 0;
            for (let i = 0; i < parsed.scenes.length; i++) {
              const s = parsed.scenes[i];
              // Ensure we don't exceed the target duration
              if (runningTotal >= targetDuration) break;
              
              // Clamp duration between 1 and 5 seconds, and ensure we don't exceed the remaining target duration
              let safeDuration = Math.min(Math.max(Number(s.duration) || 5, 1), 5);
              safeDuration = Math.min(safeDuration, targetDuration - runningTotal);
              
              scenes.push({
                sceneIndex: i,
                duration: safeDuration,
                prompt: s.prompt || `${prompt} (Scene ${i+1})`,
                narration: s.narration || ''
              });
              runningTotal += safeDuration;
            }
            
            // If the LLM came up short, pad it
            while (runningTotal < targetDuration) {
               const padDuration = Math.min(5, targetDuration - runningTotal);
               scenes.push({
                 sceneIndex: scenes.length,
                 duration: padDuration,
                 prompt: scenes[scenes.length - 1]?.prompt || prompt
               });
               runningTotal += padDuration;
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

  async stitchScenes(videoUrls: string[], audioUrl?: string, voiceoverUrl?: string): Promise<string> {
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
      
      // 3. Mix audio tracks
      const hasVoiceover = !!voiceoverUrl;
      const hasMusic = !!audioUrl;

      if (hasVoiceover && hasMusic) {
        // Mix voiceover (full volume) + music (30% volume) + video
        console.log(`[Orchestrator] Mixing voiceover + background music...`);
        const voPath = path.join(tmpDir, `vo_${jobId}.mp3`);
        const musicPath = path.join(tmpDir, `music_${jobId}.wav`);
        
        const [voRes, musicRes] = await Promise.all([fetch(voiceoverUrl), fetch(audioUrl)]);
        if (!voRes.ok) throw new Error('Failed to download voiceover');
        if (!musicRes.ok) throw new Error('Failed to download music');
        
        await Promise.all([
          fs.writeFile(voPath, Buffer.from(await voRes.arrayBuffer())),
          fs.writeFile(musicPath, Buffer.from(await musicRes.arrayBuffer()))
        ]);
        
        // amix: voiceover at full volume, music at 30%
        const mixCmd = `ffmpeg -y -i "${concatenatedVideoPath}" -i "${voPath}" -i "${musicPath}" -filter_complex "[1:a]volume=1.0[vo];[2:a]volume=0.3[bg];[vo][bg]amix=inputs=2:duration=first[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${outPathPublic}"`;
        await execPromise(mixCmd);
        
        await fs.unlink(voPath).catch(() => {});
        await fs.unlink(musicPath).catch(() => {});
      } else if (hasVoiceover) {
        // Voiceover only
        console.log(`[Orchestrator] Adding voiceover to video...`);
        const voPath = path.join(tmpDir, `vo_${jobId}.mp3`);
        const voRes = await fetch(voiceoverUrl);
        if (!voRes.ok) throw new Error('Failed to download voiceover');
        await fs.writeFile(voPath, Buffer.from(await voRes.arrayBuffer()));
        
        const mixCmd = `ffmpeg -y -i "${concatenatedVideoPath}" -i "${voPath}" -c:v copy -c:a aac -shortest "${outPathPublic}"`;
        await execPromise(mixCmd);
        await fs.unlink(voPath).catch(() => {});
      } else if (hasMusic) {
        // Background music only
        console.log(`[Orchestrator] Adding background music to video...`);
        const audioPath = path.join(tmpDir, `audio_${jobId}.wav`);
        const audRes = await fetch(audioUrl);
        if (!audRes.ok) throw new Error('Failed to download audio for stitching');
        await fs.writeFile(audioPath, Buffer.from(await audRes.arrayBuffer()));
        
        const mixCmd = `ffmpeg -y -i "${concatenatedVideoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outPathPublic}"`;
        await execPromise(mixCmd);
        await fs.unlink(audioPath).catch(() => {});
      } else {
        // No audio — just move video
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
        let imageUrl = scene.imageUrl;
        
        if (!imageUrl) {
          updateSceneAndNotify(scene.index, { status: 'generating_image' });
          // Generate Flux Keyframe
          imageUrl = await this.provider.generateImage(scene.prompt, '16:9');
        } else {
          console.log(`[Orchestrator] Scene ${scene.index} already has an injected imageUrl, skipping generation.`);
        }

        updateSceneAndNotify(scene.index, {
          status: 'generating_motion',
          imageUrl
        });

        // Generate Motion Clip
        const options: any = {};
        if (scene.loraSafetensorsUrl) {
           options.lora_safetensors_url = scene.loraSafetensorsUrl;
        }
        
        // Append trigger token to prompt if not already present
        let finalPrompt = scene.prompt;
        if (scene.loraTriggerToken && !finalPrompt.includes(scene.loraTriggerToken)) {
            finalPrompt = `${scene.loraTriggerToken}, ${finalPrompt}`;
        }
        
        const videoUrl = await this.provider.generateMotion(imageUrl, finalPrompt, scene.duration, videoEngine, options);
        updateSceneAndNotify(scene.index, {
          status: 'completed',
          videoUrl
        });

        return videoUrl;
      });

      // Audio generation Promise (background music/SFX)
      let audioPromise: Promise<string | undefined> = Promise.resolve(undefined);
      if (includeAudio) {
        console.log(`[Orchestrator] Dispatching Audio Task for prompt: "${audioPrompt}"`);
        const totalDuration = scenesList.reduce((acc, s) => acc + s.duration, 0);
        audioPromise = this.provider.generateAudio(audioPrompt, totalDuration).catch((err) => {
          console.error(`[Orchestrator] Audio generation failed, continuing without audio:`, err.message);
          return undefined;
        });
      }

      // Voiceover generation Promise (narration from LLM-generated narration text)
      let voiceoverPromise: Promise<string | undefined> = Promise.resolve(undefined);
      if (includeAudio) {
        // Build narration script from scene narrations (not visual prompts)
        const narrationParts = scenesList
          .map(s => s.narration)
          .filter(n => n && n.trim().length > 0);
        
        if (narrationParts.length > 0) {
          const narrationScript = narrationParts.join('. ');
          console.log(`[Orchestrator] Generating voiceover from ${narrationParts.length} scene narrations...`);
          voiceoverPromise = this.provider.generateVoiceover(narrationScript, 'nova').catch((err) => {
            console.error(`[Orchestrator] Voiceover generation failed, continuing without voiceover:`, err.message);
            return undefined;
          });
        } else {
          console.log(`[Orchestrator] No narration text found in scenes, skipping voiceover.`);
        }
      }

      const [videoUrls, generatedAudioUrl, generatedVoiceoverUrl] = await Promise.all([
        Promise.all(renderTasks),
        audioPromise,
        voiceoverPromise
      ]);

      // 4. Stitch clips with audio layers
      if (onProgress) {
        onProgress({ status: 'stitching', progress: 85 });
      }
      const finalVideoUrl = await this.stitchScenes(videoUrls, generatedAudioUrl, generatedVoiceoverUrl);

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
