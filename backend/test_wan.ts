import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { RunPodVideoProvider } from './src/core/runpod_provider';

async function testWan() {
  console.log("Initializing RunPod Provider...");
  console.log("WAN Endpoint:", process.env.RUNPOD_WAN_ENDPOINT_ID);
  
  const provider = new RunPodVideoProvider({
    apiKey: process.env.RUNPOD_API_KEY!,
    fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID!,
    wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID!,
    ltxEndpointId: '',
    audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID!,
    loraEndpointId: process.env.RUNPOD_LORA_ENDPOINT_ID!
  });

  // A public dummy image to prevent 404 since R2 was cleared
  const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg";
  const prompt = "Pixar 3D: Tamatar looking at a magical glowing butterfly in the circus, her eyes wide with wonder, slowly zooming in, high quality, masterpiece";
  
  console.log("\n[Test] Sending Image to WAN Endpoint (ComfyUI)");
  console.log("[Test] Image URL:", imageUrl);
  console.log("[Test] Prompt:", prompt);
  console.log("\n[Test] This may take 5-8 minutes if it's a cold start...");

  try {
    const videoUrl = await provider.generateMotion(imageUrl, prompt, 3, 'wan');
    console.log("\n[Test] SUCCESS! Video generated!");
    console.log("[Test] Video URL:", videoUrl);
  } catch (err) {
    console.error("\n[Test] FAILED:", err);
  }
}

testWan();
