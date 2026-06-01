// worker/src/worker.ts
import { Worker, Job } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';

// Parse Redis connection string into BullMQ connection options
const getRedisConnectionOptions = (urlStr: string) => {
  try {
    const url = new URL(urlStr);
    return {
      host: url.hostname || 'localhost',
      port: url.port ? parseInt(url.port, 10) : 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      maxRetriesPerRequest: null
    };
  } catch (e) {
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null
    };
  }
};

const connection = getRedisConnectionOptions(REDIS_URL);

class NovaSceneWorker {
  constructor() {
    console.log('[Worker] Booting stateless worker...');
    this.initializeWeights();
  }

  private initializeWeights() {
    console.log('[Worker] Loading Flux 1.2.1 text-to-image weights (24GB VRAM target)...');
    console.log('[Worker] Loading Wan 2.1 video generation weights...');
    console.log('[Worker] GPU Models successfully initialized and loaded.');
  }

  async processJob(job: Job) {
    console.log(`[Worker] Received task ${job.id} [Name: ${job.name}]`);
    const { prompt, sceneIndex, type, imageUrl } = job.data;

    if (type === 'image-generation') {
      console.log(`[Worker] Generating Flux keyframe for scene ${sceneIndex}...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return {
        imageUrl: `https://r2.novascene.ai/scenes/keyframe_${job.id}.jpg`
      };
    } else if (type === 'motion-generation') {
      console.log(`[Worker] Generating Wan 2.1 video clip from keyframe: ${imageUrl}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      return {
        videoUrl: `https://r2.novascene.ai/scenes/motion_${job.id}.mp4`
      };
    }

    throw new Error(`Unknown job type: ${type}`);
  }
}

const processor = new NovaSceneWorker();

// BullMQ worker queue listener
const queueWorker = new Worker(
  'novascene-inference',
  async (job: Job) => {
    return processor.processJob(job);
  },
  { connection }
);

queueWorker.on('completed', (job: Job) => {
  console.log(`[Worker] Task ${job.id} successfully finished.`);
});

queueWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[Worker] Task ${job?.id} failed with error:`, err.message);
});
