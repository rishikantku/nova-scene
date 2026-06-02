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
            const urlVal = data.output.image_url || data.output.video_url || data.output.audio_url || data.output.url;
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
    console.log(`[RunPod] generateMotion called with videoEngine: ${videoEngine}`);
    const endpointId = videoEngine === "ltx" ? this.ltxEndpointId : this.wanEndpointId;
    
    if (!endpointId) {
      throw new Error(`Endpoint ID for video engine '${videoEngine}' is not configured.`);
    }

    let payload: any = {
      image_url: imageUrl,
      prompt,
      duration,
      num_inference_steps: videoEngine === "ltx" ? 50 : 30, // LTX requires 50 steps, Wan works well at 30
      ...options
    };

    if (videoEngine === "wan") {
      try {
        const fs = require('fs');
        const path = require('path');
        const workflowPath = path.join(__dirname, 'wan_comfy_workflow.json');
        const workflowData = fs.readFileSync(workflowPath, 'utf-8');
        const workflowJson = JSON.parse(workflowData);
        
        // Inject prompt into WanVideoWrapper node (node "4")
        if (workflowJson["4"] && workflowJson["4"].inputs) {
          workflowJson["4"].inputs.prompt = prompt;
        }

        // If a LoRA URL is provided in options, dynamically inject a LoraLoader node
        if (options.lora_safetensors_url) {
           console.log(`[RunPod] Injecting LoRA node with URL: ${options.lora_safetensors_url}`);
           // Node 12 is the CheckpointLoaderSimple. 
           // We insert a LoraLoader (node 13) between node 12 and node 11 (IPAdapterApply).
           workflowJson["13"] = {
             "inputs": {
                "lora_name": options.lora_safetensors_url, // For RunPod, we assume our custom comfy handler can download URL-based LoRAs, or we pass the url.
                "strength_model": 1.0,
                "strength_clip": 1.0,
                "model": ["12", 0]
             },
             "class_type": "LoraLoader",
             "_meta": { "title": "Load Character LoRA" }
           };
           // Update IPAdapterApply to pull model from LoraLoader instead of CheckpointLoader
           if (workflowJson["11"] && workflowJson["11"].inputs) {
               workflowJson["11"].inputs.model = ["13", 0];
           }
        }
        
        payload.workflow_json = workflowJson;
        console.log(`[RunPod] Injected ComfyUI workflow for WAN 2.2 job`);
      } catch (err) {
        console.warn(`[RunPod] Could not load wan_comfy_workflow.json, falling back to raw script.`, err);
      }
    }

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
    const result = await this.pollJobStatus(this.loraEndpointId, jobId, 3600);
    
    if (result && result.lora_url) {
        return result.lora_url;
    }
    return "";
  }
}
