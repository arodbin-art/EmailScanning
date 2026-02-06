export function buildEmailBaseKey(provider: string, receivedAt: Date, messageId: string): string {
  const year = receivedAt.getUTCFullYear()
  const month = String(receivedAt.getUTCMonth() + 1).padStart(2, "0")
  return `emails/${provider}/${year}/${month}/${sanitize(messageId)}/`
}

export function buildAttachmentKey(baseKey: string, attachmentId: string, name: string): string {
  const safeName = sanitize(name)
  const safeId = sanitize(attachmentId)
  return `${baseKey}attachments/${safeId}_${safeName}`
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_")
}
