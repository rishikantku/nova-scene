// backend/tests/orchestration.test.ts
import request from 'supertest';
import app from '../src/index';

describe('NovaScene API Orchestration Tests', () => {
  it('should create a new rendering job', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({
        prompt: 'A futuristic samurai walking through neon Tokyo in the rain',
        aspect_ratio: '16:9',
        duration_target: 15
      });
      
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('job_id');
    expect(res.body).toHaveProperty('project_id');
    expect(res.body.status).toBe('queued');
  });

  it('should return 404 for nonexistent jobs', async () => {
    const res = await request(app).get('/api/v1/jobs/nonexistent-id');
    expect(res.status).toBe(404);
  });
});
