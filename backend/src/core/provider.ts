// backend/src/core/provider.ts

export interface VideoProvider {
  /**
   * Generates a keyframe image from a text prompt.
   */
  generateImage(prompt: string, aspectRatio: string, options?: Record<string, any>): Promise<string>;

  /**
   * Generates a 3-5s animated clip using a starting keyframe image and prompt.
   */
  generateMotion(imageUrl: string, prompt: string, duration: number, videoEngine: string, options?: Record<string, any>): Promise<string>;

  /**
   * Generates a background audio or SFX clip from a text prompt.
   */
  generateAudio(prompt: string, duration: number, options?: Record<string, any>): Promise<string>;
}

export class MockVideoProvider implements VideoProvider {
  private mockImages = [
    "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=400&q=80",
    "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=400&q=80",
    "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=400&q=80"
  ];

  async generateImage(prompt: string, aspectRatio: string, options?: Record<string, any>): Promise<string> {
    console.log(`[MockProvider] Generating Flux 1.2.1 keyframe for prompt: "${prompt}"`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Pick a random image from the mock selection
    const index = Math.floor(Math.random() * this.mockImages.length);
    return this.mockImages[index];
  }

  async generateMotion(imageUrl: string, prompt: string, duration: number, videoEngine: string, options?: Record<string, any>): Promise<string> {
    console.log(`[MockProvider] Generating ${videoEngine} motion clip using image: ${imageUrl}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    // Return local playable video
    return "http://localhost:8000/static/video.mp4";
  }

  async generateAudio(prompt: string, duration: number, options?: Record<string, any>): Promise<string> {
    console.log(`[MockProvider] Generating AudioLDM2 audio for prompt: "${prompt}"`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Return local playable audio
    return "http://localhost:8000/static/audio.mp3";
  }
}
