import { prisma } from "../db/prisma.js"
import { AssignmentContext, AccountAssignmentStrategy } from "./types.js"

export class StaticAssignmentStrategy implements AccountAssignmentStrategy {
  private readonly accountIds: number[]

  constructor(accountIds: number[]) {
    this.accountIds = accountIds
  }

  async resolveAssignedAccounts(_context: AssignmentContext): Promise<number[]> {
    return this.accountIds
  }

  static parseFromEnv(): StaticAssignmentStrategy {
    const raw = process.env.MAIL_ACCOUNT_IDS ?? ""
    const accountIds = raw
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value))

    if (accountIds.length === 0) {
      throw new Error("MAIL_ACCOUNT_IDS must be set with at least one account id")
    }

    return new StaticAssignmentStrategy(accountIds)
  }

  async validateAssignedAccounts(): Promise<void> {
    const rows = await prisma.mailAccount.findMany({
      where: { id: { in: this.accountIds } },
      select: { id: true, enabled: true },
    })

    const foundIds = new Set(rows.map((row) => row.id))
    const missing = this.accountIds.filter((id) => !foundIds.has(id))
    if (missing.length > 0) {
      throw new Error(`Assigned mail account ids not found: ${missing.join(", ")}`)
    }

    const disabled = rows.filter((row) => !row.enabled).map((row) => row.id)
    if (disabled.length > 0) {
      throw new Error(`Assigned mail account ids are disabled: ${disabled.join(", ")}`)
    }
  }
}
