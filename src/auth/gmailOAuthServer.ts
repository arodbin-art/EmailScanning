import "dotenv/config"
import http from "http"
import { google } from "googleapis"
import { EncryptedFileGmailTokenStore } from "./gmailTokenStore.js"

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"

type OAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export async function runGmailOAuthServer(params?: { label?: string }): Promise<void> {
  const label = params?.label ?? process.argv[2]
  if (!label) {
    throw new Error("OAuth label is required. Usage: node dist/auth/gmailOAuthServer.js <label>")
  }

  const clientId = requireEnv("GOOGLE_CLIENT_ID")
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET")
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:8787/oauth2callback"
  const oauth = createOAuthClient({ clientId, clientSecret, redirectUri })
  const tokenStore = new EncryptedFileGmailTokenStore()

  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    scope: [GMAIL_SCOPE],
    prompt: "consent",
  })

  console.log("Open this URL in your browser to authorize Gmail access:")
  console.log(authUrl)

  await waitForCallback(oauth, tokenStore, label, redirectUri)
}

function createOAuthClient(config: OAuthConfig) {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri)
}

async function waitForCallback(
  oauth: ReturnType<typeof createOAuthClient>,
  tokenStore: EncryptedFileGmailTokenStore,
  label: string,
  redirectUri: string
): Promise<void> {
  const redirect = new URL(redirectUri)
  const port = Number(redirect.port || 8787)
  const path = redirect.pathname || "/oauth2callback"

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url) {
          res.writeHead(400)
          res.end("Missing URL")
          return
        }
        const requestUrl = new URL(req.url, `http://localhost:${port}`)
        if (requestUrl.pathname !== path) {
          res.writeHead(404)
          res.end("Not found")
          return
        }
        const code = requestUrl.searchParams.get("code")
        if (!code) {
          res.writeHead(400)
          res.end("Missing code")
          return
        }

        const { tokens } = await oauth.getToken(code)
        if (!tokens.refresh_token) {
          res.writeHead(500)
          res.end("Missing refresh token; revoke access and re-run with prompt=consent.")
          return
        }

        const credentialRef = await tokenStore.saveRefreshToken(label, tokens.refresh_token)
        res.writeHead(200)
        res.end(`Gmail OAuth complete. Credential reference: ${credentialRef}`)
        server.close(() => resolve())
      } catch (error) {
        server.close(() => reject(error))
      }
    })

    server.listen(port, () => {
      console.log(`Waiting for OAuth callback on ${redirectUri}`)
    })
  })
}

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`${key} is required for Gmail OAuth`)
  }
  return value
}

if (process.argv[1]?.includes("gmailOAuthServer")) {
  runGmailOAuthServer().catch((error) => {
    console.error("gmail oauth failed", error)
    process.exit(1)
  })
}
