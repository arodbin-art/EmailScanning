import fs from "fs/promises"
import path from "path"
import crypto from "crypto"

type StoredTokenEntry = {
  iv: string
  tag: string
  data: string
}

type TokenFile = {
  version: 1
  entries: Record<string, StoredTokenEntry>
}

export type GmailTokenStore = {
  getRefreshToken(credentialRef: string): Promise<string>
  saveRefreshToken(label: string, refreshToken: string): Promise<string>
}

const REF_PREFIX = "secret://gmail/"

export class EncryptedFileGmailTokenStore implements GmailTokenStore {
  private readonly filePath: string
  private readonly key: Buffer

  constructor(params?: { filePath?: string; encryptionKey?: string }) {
    const filePath = params?.filePath ?? process.env.GMAIL_TOKEN_STORE_PATH ?? "secrets/gmail_tokens.json"
    const encryptionKey = params?.encryptionKey ?? process.env.GMAIL_TOKEN_ENCRYPTION_KEY
    if (!encryptionKey) {
      throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is required to store Gmail refresh tokens")
    }
    this.filePath = filePath
    this.key = decodeKey(encryptionKey)
  }

  async getRefreshToken(credentialRef: string): Promise<string> {
    const label = parseCredentialRef(credentialRef)
    const payload = await this.readFile()
    const entry = payload.entries[label]
    if (!entry) {
      throw new Error(`No Gmail refresh token stored for label: ${label}`)
    }
    return decrypt(entry, this.key)
  }

  async saveRefreshToken(label: string, refreshToken: string): Promise<string> {
    const payload = await this.readFile()
    payload.entries[label] = encrypt(refreshToken, this.key)
    await this.writeFile(payload)
    return `${REF_PREFIX}${label}`
  }

  private async readFile(): Promise<TokenFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8")
      const parsed = JSON.parse(raw) as TokenFile
      if (parsed.version !== 1 || typeof parsed.entries !== "object") {
        throw new Error("Invalid Gmail token store file format")
      }
      return parsed
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return { version: 1, entries: {} }
      }
      throw error
    }
  }

  private async writeFile(payload: TokenFile): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    const data = JSON.stringify(payload, null, 2)
    await fs.writeFile(this.filePath, data, { mode: 0o600 })
  }
}

export function parseCredentialRef(ref: string): string {
  if (!ref.startsWith(REF_PREFIX)) {
    throw new Error(`Invalid Gmail credential reference: ${ref}`)
  }
  const label = ref.slice(REF_PREFIX.length).trim()
  if (!label) {
    throw new Error("Gmail credential reference missing label")
  }
  return label
}

function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim()
  const buffer = trimmed.length === 64 ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64")
  if (buffer.length !== 32) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64 or hex)")
  }
  return buffer
}

function encrypt(value: string, key: Buffer): StoredTokenEntry {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64"),
  }
}

function decrypt(entry: StoredTokenEntry, key: Buffer): string {
  const iv = Buffer.from(entry.iv, "base64")
  const tag = Buffer.from(entry.tag, "base64")
  const data = Buffer.from(entry.data, "base64")
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()])
  return plaintext.toString("utf8")
}
