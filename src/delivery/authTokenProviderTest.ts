import { createDeliveryTokenProviderFromEnv } from "./authTokenProvider.js"

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function snapshotEnv(): Record<string, string | undefined> {
  return {
    RVI_AUTH_MODE: process.env.RVI_AUTH_MODE,
    RVI_STATIC_BEARER_ALLOW: process.env.RVI_STATIC_BEARER_ALLOW,
    RVI_AUTH_TENANT_ID: process.env.RVI_AUTH_TENANT_ID,
    RVI_AUTH_CLIENT_ID: process.env.RVI_AUTH_CLIENT_ID,
    RVI_AUTH_CLIENT_SECRET: process.env.RVI_AUTH_CLIENT_SECRET,
    RVI_AUTH_RESOURCE: process.env.RVI_AUTH_RESOURCE,
    RVI_BEARER_TOKEN: process.env.RVI_BEARER_TOKEN,
    ENTRA_TENANT_ID: process.env.ENTRA_TENANT_ID,
    ENTRA_CLIENT_ID: process.env.ENTRA_CLIENT_ID,
    ENTRA_CLIENT_SECRET: process.env.ENTRA_CLIENT_SECRET,
    ENTRA_API_SCOPE: process.env.ENTRA_API_SCOPE,
    GRAPH_TENANT_ID: process.env.GRAPH_TENANT_ID,
    GRAPH_CLIENT_ID: process.env.GRAPH_CLIENT_ID,
    GRAPH_CLIENT_SECRET: process.env.GRAPH_CLIENT_SECRET,
  }
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function clearAuthEnv(): void {
  for (const key of [
    "RVI_AUTH_MODE",
    "RVI_STATIC_BEARER_ALLOW",
    "RVI_AUTH_TENANT_ID",
    "RVI_AUTH_CLIENT_ID",
    "RVI_AUTH_CLIENT_SECRET",
    "RVI_AUTH_RESOURCE",
    "RVI_BEARER_TOKEN",
    "ENTRA_TENANT_ID",
    "ENTRA_CLIENT_ID",
    "ENTRA_CLIENT_SECRET",
    "ENTRA_API_SCOPE",
    "GRAPH_TENANT_ID",
    "GRAPH_CLIENT_ID",
    "GRAPH_CLIENT_SECRET",
  ]) {
    delete process.env[key]
  }
}

function testStaticModeBlockedWithoutAllow(): void {
  const original = snapshotEnv()
  clearAuthEnv()
  process.env.RVI_AUTH_MODE = "static"
  process.env.RVI_BEARER_TOKEN = "x"

  let threw = false
  try {
    createDeliveryTokenProviderFromEnv()
  } catch (error) {
    threw = String(error).includes("RVI static bearer mode is disabled")
  }
  restoreEnv(original)

  assert(threw, "static mode should throw without explicit allow")
}

function testStaticModeAllowedReturnsUndefinedProvider(): void {
  const original = snapshotEnv()
  clearAuthEnv()
  process.env.RVI_AUTH_MODE = "static"
  process.env.RVI_STATIC_BEARER_ALLOW = "true"
  process.env.RVI_BEARER_TOKEN = "x"

  const provider = createDeliveryTokenProviderFromEnv()
  restoreEnv(original)

  assert(provider === undefined, "static mode should not create token provider")
}

function testDefaultModeRequiresClientCreds(): void {
  const original = snapshotEnv()
  clearAuthEnv()

  let threw = false
  try {
    createDeliveryTokenProviderFromEnv()
  } catch (error) {
    threw = String(error).includes("RVI client-credentials auth requires")
  }
  restoreEnv(original)

  assert(threw, "default mode should require client credentials")
}

function testClientCredentialsProviderCreated(): void {
  const original = snapshotEnv()
  clearAuthEnv()
  process.env.RVI_AUTH_MODE = "client_credentials"
  process.env.RVI_AUTH_TENANT_ID = "tenant"
  process.env.RVI_AUTH_CLIENT_ID = "client"
  process.env.RVI_AUTH_CLIENT_SECRET = "secret"
  process.env.RVI_AUTH_RESOURCE = "api://resource"

  const provider = createDeliveryTokenProviderFromEnv()
  restoreEnv(original)

  assert(typeof provider === "function", "client credentials provider should be created")
}

function main(): void {
  testStaticModeBlockedWithoutAllow()
  testStaticModeAllowedReturnsUndefinedProvider()
  testDefaultModeRequiresClientCreds()
  testClientCredentialsProviderCreated()
  console.log("authTokenProviderTest ok")
}

main()
