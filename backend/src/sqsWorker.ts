import { loadDb, saveDb, simulateJobRenderPhase, simulateJobPlanningPhase, simulateCharacterGeneration } from './index';

export const handler = async (event: any) => {
  // Load the database from S3
  await loadDb();

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      console.log(`[SQS Worker] Processing message of type: ${body.type}`);
      if (body.type === 'plan' && body.jobId) {
        await simulateJobPlanningPhase(body.jobId, body.prompt, body.duration, body.visualStyle);
      } else if (body.type === 'render' && body.jobId) {
        await simulateJobRenderPhase(body.jobId);
      } else if (body.type === 'character' && body.characterId) {
        await simulateCharacterGeneration(body.characterId, body.enableLora, body.referenceImageUrl);
      }
    } catch (e) {
      console.error(`[SQS Worker] Failed to process message:`, e);
      throw e; // Throwing error will make SQS retry the message
    }
  }

  // Save the database back to S3
  await saveDb();
};
