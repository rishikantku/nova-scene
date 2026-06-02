// backend/src/core/runpod_provider.ts
import { VideoProvider } from './provider';

interface RunPodConfig {
  apiKey: string;
  fluxEndpointId: string;
  wanEndpointId: string;
  ltxEndpointId: string;
  audioEndpointId: string;
}

export class RunPodVideoProvider implements VideoProvider {
  private apiKey: string;
  private fluxEndpointId: string;
  private wanEndpointId: string;
  private ltxEndpointId: string;
  private audioEndpointId: string;

  constructor(config: RunPodConfig) {
    if (!config.apiKey) {
      throw new Error('RunPod API Key is required for RunPodVideoProvider.');
    }
    this.apiKey = config.apiKey;
    this.fluxEndpointId = config.fluxEndpointId;
    this.wanEndpointId = config.wanEndpointId;
    this.ltxEndpointId = config.ltxEndpointId;
    this.audioEndpointId = config.audioEndpointId;
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
            const urlVal = data.output.image_url || data.output.video_url || data.output.url;
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

    const payload = {
      prompt,
      aspect_ratio: aspectRatio,
      width: aspectRatio === '16:9' ? 1024 : 576,
      height: aspectRatio === '16:9' ? 576 : 1024,
      num_inference_steps: 28,
      ...options
    };

    const jobId = await this.submitJob(this.fluxEndpointId, payload);
    return this.pollJobStatus(this.fluxEndpointId, jobId, 600);
  }

  async generateMotion(imageUrl: string, prompt: string, duration: number, videoEngine: string, options?: Record<string, any>): Promise<string> {
    const endpointId = videoEngine === "ltx" ? this.ltxEndpointId : this.wanEndpointId;
    
    if (!endpointId) {
      throw new Error(`Endpoint ID for video engine '${videoEngine}' is not configured.`);
    }

    const payload = {
      image_url: imageUrl,
      prompt,
      duration,
      num_inference_steps: videoEngine === "ltx" ? 50 : 30, // LTX requires 50 steps, Wan works well at 30
      ...options
    };

    // If Wan, timeout is 3600. If LTX, timeout is 600.
    const timeout = videoEngine === "ltx" ? 600 : 3600;

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
}
