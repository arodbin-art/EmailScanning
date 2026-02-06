import { MonitorDefinition, SenderRule } from "./types.js"

export type MonitorMatchResult = {
  monitor: MonitorDefinition
  matches: boolean
  reasons: string[]
  matchedFields: Record<string, unknown>
}

export type EmailSnapshot = {
  fromAddress: string
  subject?: string
  normalizedBody: string
  hasAttachments: boolean
  labels?: string[]
}

export class MonitorEvaluator {
  evaluate(monitors: MonitorDefinition[], email: EmailSnapshot, accountId: number): MonitorMatchResult[] {
    return monitors.map((monitor) => {
      const reasons: string[] = []
      const matchedFields: Record<string, unknown> = {}

      if (!this.accountMatches(monitor, accountId)) {
        return { monitor, matches: false, reasons: ["account_scope"], matchedFields }
      }

      if (monitor.senderRules && monitor.senderRules.length > 0) {
        const senderMatched = monitor.senderRules.find((rule) => this.senderRuleMatches(rule, email.fromAddress))
        if (!senderMatched) {
          reasons.push("sender_rules")
        } else {
          matchedFields.sender_rules = senderMatched
        }
      }

      if (monitor.fromContains) {
        const value = monitor.fromContains.toLowerCase()
        if (!email.fromAddress.toLowerCase().includes(value)) {
          reasons.push("from_contains")
        } else {
          matchedFields.from_contains = monitor.fromContains
        }
      }

      if (monitor.subjectContains) {
        const subject = email.subject ?? ""
        const value = monitor.subjectContains.toLowerCase()
        if (!subject.toLowerCase().includes(value)) {
          reasons.push("subject_contains")
        } else {
          matchedFields.subject_contains = monitor.subjectContains
        }
      }

      if (monitor.subjectRegex) {
        const regex = safeRegex(monitor.subjectRegex)
        if (!regex || !regex.test(email.subject ?? "")) {
          reasons.push("subject_regex")
        } else {
          matchedFields.subject_regex = monitor.subjectRegex
        }
      }

      if (monitor.bodyRegex) {
        const regex = safeRegex(monitor.bodyRegex)
        if (!regex || !regex.test(email.normalizedBody)) {
          reasons.push("body_regex")
        } else {
          matchedFields.body_regex = monitor.bodyRegex
        }
      }

      if (monitor.hasAttachments !== undefined && monitor.hasAttachments !== null) {
        if (monitor.hasAttachments !== email.hasAttachments) {
          reasons.push("has_attachments")
        } else {
          matchedFields.has_attachments = monitor.hasAttachments
        }
      }

      if (monitor.gmailLabel) {
        const labels = email.labels ?? []
        if (!labels.includes(monitor.gmailLabel)) {
          reasons.push("gmail_label")
        } else {
          matchedFields.gmail_label = monitor.gmailLabel
        }
      }

      return { monitor, matches: reasons.length === 0, reasons, matchedFields }
    })
  }

  private accountMatches(monitor: MonitorDefinition, accountId: number): boolean {
    if (monitor.scope === "all") {
      return true
    }
    return monitor.mailAccountIds?.includes(accountId) ?? false
  }

  private senderRuleMatches(rule: SenderRule, fromAddress: string): boolean {
    const lower = fromAddress.toLowerCase()
    if (rule.type === "exact") {
      return lower === rule.value.toLowerCase()
    }
    if (rule.type === "domain") {
      const domain = lower.split("@")[1] ?? ""
      return domain === rule.value.toLowerCase()
    }
    if (rule.type === "regex") {
      const regex = safeRegex(rule.value)
      return !!regex?.test(fromAddress)
    }
    return false
  }
}

function safeRegex(value: string): RegExp | null {
  try {
    return new RegExp(value, "i")
  } catch {
    return null
  }
}
