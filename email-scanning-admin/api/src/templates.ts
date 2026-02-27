import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type MonitorTemplateDefaults = {
  provider: string;
  sender_rules?: string[] | null;
  subject_regex?: string | null;
  body_regex?: string | null;
  event_family_prefixes?: string[] | null;
  enabled?: boolean;
};

export type MonitorTemplateRecord = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  version: string;
  monitor_defaults: MonitorTemplateDefaults;
};

export type TemplateRegistry = {
  version: number;
  templates: MonitorTemplateRecord[];
};

type CachedRegistry = {
  mtimeMs: number;
  registry: TemplateRegistry;
};

let cachedRegistry: CachedRegistry | null = null;
let cachedPath: string | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`);
  }
  const output = value.map((entry, index) => assertString(entry, `${field}[${index}]`));
  return output;
}

function parseTemplate(record: unknown, index: number): MonitorTemplateRecord {
  if (!isRecord(record)) {
    throw new Error(`templates[${index}] must be an object`);
  }
  const monitorDefaults = record.monitor_defaults;
  if (!isRecord(monitorDefaults)) {
    throw new Error(`templates[${index}].monitor_defaults must be an object`);
  }
  const provider = assertString(monitorDefaults.provider, `templates[${index}].monitor_defaults.provider`);
  return {
    id: assertString(record.id, `templates[${index}].id`),
    name: assertString(record.name, `templates[${index}].name`),
    description: assertString(record.description, `templates[${index}].description`),
    tags: assertStringArray(record.tags, `templates[${index}].tags`),
    version: assertString(record.version, `templates[${index}].version`),
    monitor_defaults: {
      provider,
      sender_rules: monitorDefaults.sender_rules
        ? assertStringArray(monitorDefaults.sender_rules, `templates[${index}].monitor_defaults.sender_rules`)
        : null,
      subject_regex:
        monitorDefaults.subject_regex === null || monitorDefaults.subject_regex === undefined
          ? null
          : assertString(monitorDefaults.subject_regex, `templates[${index}].monitor_defaults.subject_regex`),
      body_regex:
        monitorDefaults.body_regex === null || monitorDefaults.body_regex === undefined
          ? null
          : assertString(monitorDefaults.body_regex, `templates[${index}].monitor_defaults.body_regex`),
      event_family_prefixes: monitorDefaults.event_family_prefixes
        ? assertStringArray(
            monitorDefaults.event_family_prefixes,
            `templates[${index}].monitor_defaults.event_family_prefixes`
          )
        : null,
      enabled:
        monitorDefaults.enabled === null || monitorDefaults.enabled === undefined
          ? false
          : Boolean(monitorDefaults.enabled)
    }
  };
}

function parseRegistry(content: unknown): TemplateRegistry {
  if (!isRecord(content)) {
    throw new Error('Template registry must be an object');
  }
  if (typeof content.version !== 'number') {
    throw new Error('Template registry version must be a number');
  }
  if (!Array.isArray(content.templates)) {
    throw new Error('Template registry templates must be an array');
  }
  const templates = content.templates.map((record, index) => parseTemplate(record, index));
  const ids = new Set<string>();
  for (const template of templates) {
    if (ids.has(template.id)) {
      throw new Error(`Duplicate template id: ${template.id}`);
    }
    ids.add(template.id);
  }
  return {
    version: content.version,
    templates
  };
}

function resolveTemplatesFilePath(): string {
  if (process.env.TEMPLATE_REGISTRY_FILE) {
    return path.resolve(process.env.TEMPLATE_REGISTRY_FILE);
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'templates', 'templates.json'),
    path.resolve(process.cwd(), 'email-scanning-admin', 'api', 'templates', 'templates.json'),
    path.resolve(moduleDir, '..', 'templates', 'templates.json')
  ];
  const hit = candidates.find((candidate) => fs.existsSync(candidate));
  return hit ?? candidates[0];
}

export function loadTemplateRegistryFromFile(filePath: string): TemplateRegistry {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return parseRegistry(parsed);
}

export function getTemplateRegistry(): TemplateRegistry {
  const filePath = resolveTemplatesFilePath();
  const stat = fs.statSync(filePath);
  if (cachedRegistry && cachedPath === filePath && cachedRegistry.mtimeMs === stat.mtimeMs) {
    return cachedRegistry.registry;
  }
  const registry = loadTemplateRegistryFromFile(filePath);
  cachedRegistry = { mtimeMs: stat.mtimeMs, registry };
  cachedPath = filePath;
  return registry;
}

export function listTemplateSummaries() {
  const registry = getTemplateRegistry();
  return registry.templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    tags: template.tags,
    version: template.version
  }));
}

export function getTemplateById(id: string): MonitorTemplateRecord | null {
  const registry = getTemplateRegistry();
  return registry.templates.find((template) => template.id === id) ?? null;
}
