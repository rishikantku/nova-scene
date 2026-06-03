import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { RunPodVideoProvider } from './src/core/runpod_provider';

async function testE2E() {
  console.log("Initializing E2E RunPod Provider Test...");
  
  const provider = new RunPodVideoProvider({
    apiKey: process.env.RUNPOD_API_KEY!,
    fluxEndpointId: process.env.RUNPOD_FLUX_ENDPOINT_ID!,
    wanEndpointId: process.env.RUNPOD_WAN_ENDPOINT_ID!,
    ltxEndpointId: '',
    audioEndpointId: process.env.RUNPOD_AUDIO_ENDPOINT_ID!,
    loraEndpointId: process.env.RUNPOD_LORA_ENDPOINT_ID!
  });

  try {
    console.log("\n[Test 1] Generating Image with Flux (to get a valid URL)...");
    const imageUrl = await provider.generateImage("Pixar 3D: A cute red panda wearing a tiny backpack, looking at a magical glowing butterfly in a forest, masterpiece", "16:9");
    console.log("[Test 1] SUCCESS! Flux Image URL:", imageUrl);

    console.log(`\n[Test 2] Sending Training Job for LoRA...`);
    const loraUrl = await provider.trainLora(`test_lora_${Date.now()}`, "panda", [imageUrl]);
    console.log("[Test 2] SUCCESS! LoRA Safetensors URL:", loraUrl);

    console.log("\n[Test 3] Sending Image to WAN Endpoint (ComfyUI)...");
    const videoUrl = await provider.generateMotion(imageUrl, "The cute red panda reaches out its paw to touch the glowing butterfly", 3, 'wan');
    console.log("[Test 3] SUCCESS! Video generated! URL:", videoUrl);
    
    console.log("\n✅ All Endpoints are fully functional!");

  } catch (err) {
    console.error("\n❌ [Test FAILED]:", err);
  }
}

testE2E();
