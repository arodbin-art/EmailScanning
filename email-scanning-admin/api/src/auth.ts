import { Request, Response, NextFunction } from 'express';
import { createPublicKey, verify } from 'crypto';

type AuthMode = 'token' | 'entra' | 'hybrid';

type EntraJwtPayload = {
  aud?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  tid?: string;
  oid?: string;
  [key: string]: unknown;
};

type OpenIdConfig = {
  issuer: string;
  jwks_uri: string;
};

type JwksKey = {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
  x5c?: string[];
};

type JwksResponse = {
  keys?: JwksKey[];
};

type JwksCacheValue = {
  expiresAtMs: number;
  keysByKid: Map<string, JwksKey>;
};

const JWKS_TTL_MS = 10 * 60 * 1000;
const ENTRA_LOGIN_BASE = 'https://login.microsoftonline.com';
const jwksCache = new Map<string, JwksCacheValue>();

function getAuthMode(): AuthMode {
  const raw = (process.env.ADMIN_AUTH_MODE ?? 'token').trim().toLowerCase();
  if (raw === 'token' || raw === 'entra' || raw === 'hybrid') {
    return raw;
  }
  throw new Error(`Invalid ADMIN_AUTH_MODE "${raw}". Use token, entra, or hybrid.`);
}

function getAuthorizationToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization ?? '';
  const headerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : undefined;
  const legacyHeader = (req.headers['x-admin-token'] as string | undefined)?.trim();
  return headerToken || legacyHeader || undefined;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function parseJwt(token: string): { header: Record<string, unknown>; payload: EntraJwtPayload; signedPart: string; signature: Buffer } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(decodeBase64Url(parts[0])) as Record<string, unknown>;
    const payload = JSON.parse(decodeBase64Url(parts[1])) as EntraJwtPayload;
    const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[2].length / 4) * 4, '='), 'base64');
    return {
      header,
      payload,
      signedPart: `${parts[0]}.${parts[1]}`,
      signature,
    };
  } catch {
    return null;
  }
}

function getEntraTenantIdOrThrow(): string {
  const tenantId = (process.env.ADMIN_ENTRA_TENANT_ID ?? '').trim();
  if (!tenantId) {
    throw new Error('ADMIN_ENTRA_TENANT_ID is required for Entra auth');
  }
  return tenantId;
}

function getAllowedIssuers(tenantId: string): Set<string> {
  const values = new Set<string>();
  values.add(`${ENTRA_LOGIN_BASE}/${tenantId}/v2.0`);
  values.add(`https://sts.windows.net/${tenantId}/`);
  const explicit = (process.env.ADMIN_ENTRA_ISSUER ?? '').trim();
  if (explicit) {
    values.add(explicit);
  }
  return values;
}

function getAllowedAudiences(): Set<string> {
  const audience = (process.env.ADMIN_ENTRA_AUDIENCE ?? '').trim();
  if (!audience) {
    throw new Error('ADMIN_ENTRA_AUDIENCE is required for Entra auth');
  }
  const values = new Set<string>();
  for (const raw of audience.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    values.add(trimmed);
    if (trimmed.startsWith('api://')) {
      values.add(trimmed.slice('api://'.length));
    } else if (/^[0-9a-fA-F-]{36}$/.test(trimmed)) {
      values.add(`api://${trimmed}`);
    }
  }
  return values;
}

function getEntraJwksUri(tenantId: string): string {
  return `${ENTRA_LOGIN_BASE}/${tenantId}/discovery/v2.0/keys`;
}

async function loadJwks(jwksUri: string): Promise<Map<string, JwksKey>> {
  const now = Date.now();
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.expiresAtMs > now) {
    return cached.keysByKid;
  }

  const response = await fetch(jwksUri, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS (${response.status})`);
  }
  const json = (await response.json()) as JwksResponse;
  const keysByKid = new Map<string, JwksKey>();
  for (const key of json.keys ?? []) {
    if (key.kid) {
      keysByKid.set(key.kid, key);
    }
  }
  jwksCache.set(jwksUri, {
    expiresAtMs: now + JWKS_TTL_MS,
    keysByKid,
  });
  return keysByKid;
}

function verifyJwtSignature(
  parsedJwt: ReturnType<typeof parseJwt>,
  jwk: JwksKey
): boolean {
  if (!parsedJwt) return false;
  let publicKeyPem: string | null = null;
  if (Array.isArray(jwk.x5c) && jwk.x5c[0]) {
    publicKeyPem = `-----BEGIN CERTIFICATE-----\n${jwk.x5c[0]}\n-----END CERTIFICATE-----`;
  } else if (jwk.n && jwk.e) {
    const keyObject = createPublicKey({
      key: {
        kty: 'RSA',
        n: jwk.n,
        e: jwk.e,
      },
      format: 'jwk',
    });
    publicKeyPem = keyObject.export({ format: 'pem', type: 'spki' }).toString();
  }
  if (!publicKeyPem) return false;
  return verify('RSA-SHA256', Buffer.from(parsedJwt.signedPart), publicKeyPem, parsedJwt.signature);
}

async function verifyEntraToken(token: string): Promise<boolean> {
  const parsed = parseJwt(token);
  if (!parsed) return false;
  const alg = String(parsed.header.alg ?? '');
  const kid = String(parsed.header.kid ?? '');
  if (alg !== 'RS256' || !kid) return false;

  const tenantId = getEntraTenantIdOrThrow();
  const allowedIssuers = getAllowedIssuers(tenantId);
  const allowedAudiences = getAllowedAudiences();
  const keys = await loadJwks(getEntraJwksUri(tenantId));
  const jwk = keys.get(kid);
  if (!jwk) return false;
  if (!verifyJwtSignature(parsed, jwk)) return false;

  const payload = parsed.payload;
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < nowSec) return false;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) return false;
  if (!allowedIssuers.has(String(payload.iss ?? ''))) return false;
  if (!allowedAudiences.has(String(payload.aud ?? ''))) return false;
  return true;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const mode = getAuthMode();
  const incomingToken = getAuthorizationToken(req);
  if (!incomingToken) return false;

  const staticToken = (process.env.ADMIN_TOKEN ?? '').trim();
  if ((mode === 'token' || mode === 'hybrid') && staticToken && incomingToken === staticToken) {
    return true;
  }

  if (mode === 'entra' || mode === 'hybrid') {
    return verifyEntraToken(incomingToken).catch(() => false);
  }

  return false;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const authorized = await isAuthorized(req);
    if (!authorized) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Auth misconfiguration';
    res.status(500).json({ error: message });
  }
}

export function validateAdminAuthConfigOrThrow(): void {
  const mode = getAuthMode();
  const staticToken = (process.env.ADMIN_TOKEN ?? '').trim();
  if ((mode === 'token' || mode === 'hybrid') && !staticToken) {
    throw new Error('ADMIN_TOKEN is required when ADMIN_AUTH_MODE is token or hybrid');
  }
  if (mode === 'entra' || mode === 'hybrid') {
    getEntraTenantIdOrThrow();
    getAllowedAudiences();
  }
}

export function resetAdminAuthCachesForTests(): void {
  jwksCache.clear();
}
