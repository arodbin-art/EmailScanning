import { PrismaClient } from "@prisma/client"
import { MonitorDefinition, SenderRule } from "./types.js"

export class MonitorRepository {
  private readonly db: PrismaClient

  constructor(db: PrismaClient) {
    this.db = db
  }

  async listEnabled(provider: string): Promise<MonitorDefinition[]> {
    const rows = await this.db.monitor.findMany({
      where: { enabled: true, provider },
      orderBy: { id: "asc" },
    })

    return rows.map((row: typeof rows[number]) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      provider: row.provider,
      senderRules: (row.senderRules as SenderRule[] | null) ?? undefined,
      fromContains: row.fromContains ?? undefined,
      subjectContains: row.subjectContains ?? undefined,
      subjectRegex: row.subjectRegex ?? undefined,
      bodyRegex: row.bodyRegex ?? undefined,
      hasAttachments: row.hasAttachments ?? undefined,
      gmailLabel: row.gmailLabel ?? undefined,
      scope: row.scope,
      mailAccountIds: (row.mailAccountIds as number[] | null) ?? undefined,
      aiPromptTemplate: row.aiPromptTemplate ?? undefined,
      confidenceThreshold: row.confidenceThreshold ? Number(row.confidenceThreshold) : undefined,
      allowedEventTypes: (row.allowedEventTypes as string[] | null) ?? undefined,
    }))
  }
}
