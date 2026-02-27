import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadTemplateRegistryFromFile } from './templates.js';

function withTempRegistry(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-registry-'));
  const filePath = path.join(tmpDir, 'templates.json');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

test('loads a valid template registry', () => {
  const filePath = withTempRegistry(
    JSON.stringify({
      version: 1,
      templates: [
        {
          id: 'amazon-default',
          name: 'Amazon',
          description: 'Amazon return events',
          tags: ['amazon'],
          version: '1.0.0',
          monitor_defaults: {
            provider: 'gmail',
            sender_rules: ['return@amazon.ca'],
            subject_regex: '.*',
            body_regex: null,
            event_family_prefixes: ['amazon.'],
            enabled: false
          }
        }
      ]
    })
  );

  const registry = loadTemplateRegistryFromFile(filePath);
  assert.equal(registry.version, 1);
  assert.equal(registry.templates.length, 1);
  assert.equal(registry.templates[0].id, 'amazon-default');
});

test('rejects duplicate template ids', () => {
  const filePath = withTempRegistry(
    JSON.stringify({
      version: 1,
      templates: [
        {
          id: 'dupe',
          name: 'First',
          description: 'First template',
          tags: ['a'],
          version: '1.0.0',
          monitor_defaults: { provider: 'gmail' }
        },
        {
          id: 'dupe',
          name: 'Second',
          description: 'Second template',
          tags: ['b'],
          version: '1.0.0',
          monitor_defaults: { provider: 'gmail' }
        }
      ]
    })
  );

  assert.throws(() => loadTemplateRegistryFromFile(filePath), /Duplicate template id/);
});
