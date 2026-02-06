import crypto from "crypto"

export function normalizeBody(contentType: "text" | "html", content: string): string {
  if (!content) {
    return ""
  }
  const base = contentType === "html" ? stripHtml(content) : content
  return base
    .replace(/\r\n/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
}
