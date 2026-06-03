// backend/src/core/runpod_provider.ts
import { VideoProvider } from './provider';

interface RunPodConfig {
  apiKey: string;
  fluxEndpointId: string;
  wanEndpointId: string;
  ltxEndpointId: string;
  audioEndpointId: string;
  loraEndpointId: string;
}

export class RunPodVideoProvider implements VideoProvider {
  private apiKey: string;
  private fluxEndpointId: string;
  private wanEndpointId: string;
  private ltxEndpointId: string;
  private audioEndpointId: string;
  private loraEndpointId: string;

  constructor(config: RunPodConfig) {
    if (!config.apiKey) {
      throw new Error('RunPod API Key is required for RunPodVideoProvider.');
    }
    this.apiKey = config.apiKey;
    this.fluxEndpointId = config.fluxEndpointId;
    this.wanEndpointId = config.wanEndpointId;
    this.ltxEndpointId = config.ltxEndpointId;
    this.audioEndpointId = config.audioEndpointId;
    this.loraEndpointId = config.loraEndpointId;
  }

  private async submitJob(endpointId: string, input: Record<string, any>): Promise<string> {
    const url = `https://api.runpod.ai/v1/${endpointId}/run`;
    console.log(`[RunPod] Submitting task to endpoint ${endpointId}...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ input })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`RunPod job submission failed: ${response.statusText} (${errText})`);
    }

    const data = (await response.json()) as { id: string; status: string };
    console.log(`[RunPod] Task submitted successfully. RunPod Job ID: ${data.id}`);
    return data.id;
  }

  private async pollJobStatus(endpointId: string, jobId: string, timeoutSecs = 300): Promise<string> {
    const url = `https://api.runpod.ai/v1/${endpointId}/status/${jobId}`;
    const start = Date.now();
    const intervalMs = 3000;

    console.log(`[RunPod] Starting status polling for job ${jobId}...`);

    while (Date.now() - start < timeoutSecs * 1000) {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        console.error(`[RunPod] Error querying status for job ${jobId}: ${response.statusText}`);
      } else {
        const data = (await response.json()) as {
          status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'IN_QUEUE';
          output?: any;
          error?: string;
        };

        console.log(`[RunPod] Job ${jobId} status: ${data.status}`);

        if (data.status === 'COMPLETED') {
          if (!data.output) {
            throw new Error(`RunPod job completed but returned empty output.`);
          }
          // The output can be a direct URL string or an object containing image_url/video_url/url
          if (typeof data.output === 'string') {
            return data.output;
          }
          if (typeof data.output === 'object') {
            const urlVal = data.output.image_url || data.output.video_url || data.output.audio_url || data.output.lora_url || data.output.url;
            if (urlVal) return urlVal;
          }
          return JSON.stringify(data.output);
        }

        if (data.status === 'FAILED') {
          throw new Error(`RunPod job execution failed: ${data.error || 'Unknown error'}`);
        }
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`RunPod job ${jobId} execution timed out after ${timeoutSecs} seconds.`);
  }

  async generateImage(prompt: string, aspectRatio: string, options?: Record<string, any>): Promise<string> {
    if (!this.fluxEndpointId) {
      throw new Error('RUNPOD_FLUX_ENDPOINT_ID must be configured for image generation.');
    }

    const payload: any = {
      prompt,
      aspect_ratio: aspectRatio,
      width: aspectRatio === '16:9' ? 1024 : 576,
      height: aspectRatio === '16:9' ? 576 : 1024,
      num_inference_steps: 28,
      ...options
    };

    if (options?.referenceImageUrl) {
      payload.image_prompt_url = options.referenceImageUrl;
    }

    const jobId = await this.submitJob(this.fluxEndpointId, payload);
    return this.pollJobStatus(this.fluxEndpointId, jobId, 600);
  }

  async generateMotion(imageUrl: string, prompt: string, duration: number, videoEngine: string, options?: Record<string, any>): Promise<string> {
    console.log(`[RunPod] generateMotion called with videoEngine: ${videoEngine}`);
    const endpointId = videoEngine === "ltx" ? this.ltxEndpointId : this.wanEndpointId;
    
    if (!endpointId) {
      throw new Error(`Endpoint ID for video engine '${videoEngine}' is not configured.`);
    }

    let payload: any;

    if (videoEngine === "wan") {
      // Our ComfyUI handler only reads image_url and prompt.
      // The baked-in workflow (wan_comfy_workflow.json) handles everything else.
      payload = {
        image_url: imageUrl,
        prompt,
      };
      console.log(`[RunPod] Sending simplified Wan payload: image_url + prompt`);
    } else {
      // LTX or other engines
      payload = {
        image_url: imageUrl,
        prompt,
        duration,
        num_inference_steps: 50,
        ...options
      };
    }

    // Wan jobs can take up to 20 minutes (cold start + inference). LTX is faster.
    const timeout = videoEngine === "wan" ? 1800 : 600;

    const jobId = await this.submitJob(endpointId, payload);
    return this.pollJobStatus(endpointId, jobId, timeout);
  }

  async generateAudio(prompt: string, duration: number, options?: Record<string, any>): Promise<string> {
    if (!this.audioEndpointId) {
      throw new Error('RUNPOD_AUDIO_ENDPOINT_ID must be configured for audio generation.');
    }

    const payload = {
      prompt,
      duration,
      num_inference_steps: 200,
      ...options
    };

    const jobId = await this.submitJob(this.audioEndpointId, payload);
    return this.pollJobStatus(this.audioEndpointId, jobId, 300);
  }

  async trainLora(loraId: string, triggerToken: string, datasetUrls: string[]): Promise<string> {
    console.log(`[RunPod] trainLora called for LoRA ${loraId}`);
    if (!this.loraEndpointId) {
      throw new Error(`Endpoint ID for LoRA training is not configured.`);
    }

    const payload = {
      lora_id: loraId,
      trigger_token: triggerToken,
      dataset_urls: datasetUrls
    };

    // Training can take 15-30 minutes, set timeout to 3600 (1 hour)
    const jobId = await this.submitJob(this.loraEndpointId, payload);
    const resultUrl = await this.pollJobStatus(this.loraEndpointId, jobId, 3600);
    return resultUrl;
  }

  async generateVoiceover(text: string, voice: string = 'nova', options?: Record<string, any>): Promise<string> {
    const language = options?.language || 'en';
    
    // Auto-detect Hindi/Devanagari script in the text
    const isIndianLang = ['hi', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'pa-IN', 'od-IN'].includes(language);
    const hasDevanagari = /[\u0900-\u097F]/.test(text);
    
    if ((isIndianLang || hasDevanagari) && process.env.SARVAM_API_KEY) {
      return this._voiceoverSarvam(text, voice, language);
    }
    return this._voiceoverOpenAI(text, voice);
  }

  private async _voiceoverSarvam(text: string, voice: string, language: string): Promise<string> {
    const sarvamKey = process.env.SARVAM_API_KEY!;
    const langCode = language.includes('-') ? language : `${language}-IN`;
    // Map OpenAI voice names to Sarvam defaults
    const sarvamVoice = ['alloy','echo','fable','onyx','nova','shimmer'].includes(voice) ? 'priya' : voice;

    console.log(`[TTS/Sarvam] voice=${sarvamVoice}, lang=${langCode}: "${text.substring(0, 80)}..."`);

    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': sarvamKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        target_language_code: langCode,
        speaker: sarvamVoice,
        model: 'bulbul:v3',
        pace: 1.0,
        sample_rate: 24000,
        audio_format: 'wav'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam TTS failed: ${response.statusText} (${errText})`);
    }

    const data = await response.json() as { audios?: string[] };
    if (!data.audios || data.audios.length === 0) {
      throw new Error('Sarvam TTS returned empty audio');
    }

    const audioBuffer = Buffer.from(data.audios[0], 'base64');
    return this._uploadVoiceover(audioBuffer, 'audio/wav', 'wav');
  }

  private async _voiceoverOpenAI(text: string, voice: string): Promise<string> {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error('OPENAI_API_KEY is required for voiceover.');

    console.log(`[TTS/OpenAI] voice=${voice}: "${text.substring(0, 80)}..."`);

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: text,
        voice,
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI TTS failed: ${response.statusText} (${errText})`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return this._uploadVoiceover(audioBuffer, 'audio/mpeg', 'mp3');
  }

  private async _uploadVoiceover(audioBuffer: Buffer, contentType: string, ext: string): Promise<string> {
    const cryptoMod = require('crypto');
    const filename = `voiceover_${cryptoMod.randomUUID()}.${ext}`;

    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT_URL,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    const r2Key = `scenes/${filename}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
      Body: audioBuffer,
      ContentType: contentType,
    }));

    const publicUrl = `${process.env.R2_CDN_URL}/${r2Key}`;
    console.log(`[TTS] Voiceover uploaded: ${publicUrl}`);
    return publicUrl;
  }
}
