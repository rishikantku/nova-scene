import { loadDb, saveDb, simulateJobRenderPhase, simulateJobPlanningPhase } from './index';

export const handler = async (event: any) => {
  // Load the database from S3
  await loadDb();

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      if (body.jobId) {
        console.log(`[SQS Worker] Processing ${body.type} job ${body.jobId}`);
        if (body.type === 'plan') {
          await simulateJobPlanningPhase(body.jobId, body.prompt, body.duration, body.visualStyle);
        } else if (body.type === 'render') {
          await simulateJobRenderPhase(body.jobId);
        }
      }
    } catch (e) {
      console.error(`[SQS Worker] Failed to process message:`, e);
      throw e; // Throwing error will make SQS retry the message
    }
  }

  // Save the database back to S3
  await saveDb();
};
