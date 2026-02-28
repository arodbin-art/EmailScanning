import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'crypto';
import { requireAdmin, resetAdminAuthCachesForTests } from './auth.js';

function base64Url(input: string | Buffer): string {
  const encoded = Buffer.isBuffer(input)
    ? input.toString('base64')
    : Buffer.from(input).toString('base64');
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signJwt(payload: Record<string, unknown>, privateKeyPem: string, kid: string): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const p1 = base64Url(JSON.stringify(header));
  const p2 = base64Url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${p1}.${p2}`);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  return `${p1}.${p2}.${base64Url(sig)}`;
}

function mockReq(token: string | undefined) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as any;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      this.body = value;
      return this;
    },
  } as any;
}

test('token mode accepts ADMIN_TOKEN bearer', async () => {
  process.env.ADMIN_AUTH_MODE = 'token';
  process.env.ADMIN_TOKEN = 'secret-123';
  delete process.env.ADMIN_ENTRA_AUDIENCE;
  delete process.env.ADMIN_ENTRA_TENANT_ID;
  resetAdminAuthCachesForTests();

  const req = mockReq('secret-123');
  const res = mockRes();
  let nextCalled = false;
  await requireAdmin(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('entra mode accepts valid Entra JWT', async () => {
  process.env.ADMIN_AUTH_MODE = 'entra';
  delete process.env.ADMIN_TOKEN;
  process.env.ADMIN_ENTRA_AUDIENCE = 'api://unit-test-audience';
  process.env.ADMIN_ENTRA_TENANT_ID = 'test-tenant';
  process.env.ADMIN_ENTRA_ISSUER = 'https://login.microsoftonline.com/test-tenant/v2.0';
  resetAdminAuthCachesForTests();

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' }) as any;
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const kid = 'unit-test-kid';
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt(
    {
      aud: process.env.ADMIN_ENTRA_AUDIENCE,
      iss: process.env.ADMIN_ENTRA_ISSUER,
      iat: now - 30,
      nbf: now - 30,
      exp: now + 300,
      tid: 'test-tenant',
      oid: 'user-object-id',
    },
    privatePem,
    kid
  );

  const originalFetch = global.fetch;
  global.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/discovery/v2.0/keys')) {
      return {
        ok: true,
        json: async () => ({
          keys: [
            {
              kid,
              kty: 'RSA',
              alg: 'RS256',
              n: publicJwk.n,
              e: publicJwk.e,
            },
          ],
        }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof fetch;

  try {
    const req = mockReq(token);
    const res = mockRes();
    let nextCalled = false;
    await requireAdmin(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  } finally {
    global.fetch = originalFetch;
  }
});
