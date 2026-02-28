import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';
process.env.ADMIN_AUTH_MODE = 'token';
delete process.env.ADMIN_ENTRA_AUDIENCE;
delete process.env.ADMIN_ENTRA_TENANT_ID;
delete process.env.ADMIN_ENTRA_ISSUER;

const { createApp } = await import('./app.js');
const app = createApp();

function auth(req: request.Test) {
  return req.set('X-Admin-Token', process.env.ADMIN_TOKEN as string);
}

test('GET /api/templates returns template summaries', async () => {
  const response = await auth(request(app).get('/api/templates'));
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.data), 'data should be an array');
  assert.ok(response.body.data.length >= 3, 'should include seeded templates');
  const amazon = response.body.data.find((entry: { id: string }) => entry.id === 'amazon-default');
  assert.ok(amazon, 'amazon template should exist');
});

test('GET /api/templates/:id returns full template', async () => {
  const response = await auth(request(app).get('/api/templates/manulife-claims'));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.id, 'manulife-claims');
  assert.equal(response.body.data.monitor_defaults.provider, 'gmail');
});

test('GET /api/templates/:id returns 404 for unknown id', async () => {
  const response = await auth(request(app).get('/api/templates/does-not-exist'));
  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'Template not found');
});
