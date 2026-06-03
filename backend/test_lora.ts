import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { RunPodVideoProvider } from './src/core/runpod_provider';

async function testLora() {
  console.log("Initializing RunPod Provider for LoRA...");
  console.log("LoRA Endpoint:", process.env.RUNPOD_LORA_ENDPOINT_ID);
  
  const provider = new RunPodVideoProvider({
    apiKey: process.env.RUNPOD_API_KEY!,
    fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID!,
    wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID!,
    ltxEndpointId: '',
    audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID!,
    loraEndpointId: process.env.RUNPOD_LORA_ENDPOINT_ID!
  });

  const triggerToken = "tamatar";
  const datasetUrls = [
    "https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg"
  ];
  
  const loraId = `test_lora_${Date.now()}`;

  console.log(`\n[Test] Sending Training Job for LoRA: ${loraId}`);
  console.log(`[Test] Dataset URLs: ${datasetUrls.length}`);

  try {
    const loraUrl = await provider.trainLora(loraId, triggerToken, datasetUrls);
    console.log("\n[Test] SUCCESS! LoRA Training Completed (or Simulated)!");
    console.log("[Test] Safetensors URL:", loraUrl);
  } catch (err) {
    console.error("\n[Test] FAILED:", err);
  }
}

testLora();
