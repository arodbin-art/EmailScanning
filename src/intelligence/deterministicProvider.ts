import { parseAmazonReturnEmail } from "../automation/amazonReturnParser.js"
import { parseManulifeClaimEmail } from "../automation/manulifeClaimParser.js"
import { parseOrthodonticsPaymentEmail } from "../automation/orthodonticsPaymentParser.js"
import { parseOrthodonticsAppointmentEmail } from "../automation/orthodonticsAppointmentParser.js"
import { EmailIntelligenceProvider, IntelligenceEmailInput, StructuredSignal } from "./types.js"

export class DeterministicProvider implements EmailIntelligenceProvider {
  async analyzeEmail(email: IntelligenceEmailInput): Promise<StructuredSignal[]> {
    if (!email.fromAddress) {
      return []
    }

    const amazon = parseAmazonReturnEmail({
      provider: email.provider,
      fromAddress: email.fromAddress,
      subject: email.subject,
      receivedAt: email.receivedAt,
      normalizedBody: email.normalizedText,
    })
    if (amazon) {
      return [mapAmazonSignal(email, amazon)]
    }

    const manulife = parseManulifeClaimEmail({
      provider: email.provider,
      fromAddress: email.fromAddress,
      subject: email.subject,
      receivedAt: email.receivedAt,
      normalizedBody: email.normalizedText,
    })
    if (manulife) {
      return [mapManulifeSignal(email, manulife)]
    }

    const orthodontics = parseOrthodonticsPaymentEmail({
      provider: email.provider,
      fromAddress: email.fromAddress,
      subject: email.subject,
      receivedAt: email.receivedAt,
      normalizedBody: email.normalizedText,
    })
    if (orthodontics) {
      return [
        {
          eventType: orthodontics.eventType,
          primaryRef: orthodontics.transactionId ?? orthodontics.paymentReference ?? email.emailId,
          amount: orthodontics.amount ?? undefined,
          occurredAt: email.receivedAt.toISOString(),
          confidence: 0.98,
          payload: {
            provider: orthodontics.merchant,
            amount_total: orthodontics.amount,
            currency: orthodontics.currency,
            transaction_id: orthodontics.transactionId ?? null,
            payment_reference: orthodontics.paymentReference ?? null,
            status_text: orthodontics.statusText,
          },
        },
      ]
    }

    const appointment = parseOrthodonticsAppointmentEmail({
      provider: email.provider,
      fromAddress: email.fromAddress,
      subject: email.subject,
      receivedAt: email.receivedAt,
      normalizedBody: email.normalizedText,
    })
    if (appointment) {
      return [
        {
          eventType: appointment.eventType,
          primaryRef: email.emailId,
          occurredAt: email.receivedAt.toISOString(),
          confidence: 0.95,
          payload: {
            clinic: appointment.clinic,
            status_text: appointment.statusText,
            reminder_window: appointment.reminderWindow ?? null,
          },
        },
      ]
    }

    return []
  }
}

function mapAmazonSignal(
  email: IntelligenceEmailInput,
  parsed: Awaited<ReturnType<typeof parseAmazonReturnEmail>>
): StructuredSignal {
  if (!parsed) {
    throw new Error("unexpected null Amazon parse")
  }

  if (parsed.eventType === "amazon.return_requested") {
    return {
      eventType: parsed.eventType,
      primaryRef: parsed.orderId,
      amount: parsed.refundTotalEstimated,
      occurredAt: email.receivedAt.toISOString(),
      confidence: 1,
      payload: {
        order_id: parsed.orderId,
        refund_total_estimated: parsed.refundTotalEstimated,
        drop_off_by: parsed.dropOffBy,
        return_method_location: parsed.returnMethodOrLocation ?? null,
        refund_destination_text: parsed.refundDestinationText ?? null,
        items: parsed.items,
        status_text: parsed.statusText,
        payment_method_last4: parsed.paymentMethodLast4 ?? null,
      },
    }
  }

  if (parsed.eventType === "amazon.return_dropped_off") {
    return {
      eventType: parsed.eventType,
      primaryRef: parsed.orderId,
      amount: parsed.refundTotalEstimated,
      occurredAt: email.receivedAt.toISOString(),
      confidence: 1,
      payload: {
        order_id: parsed.orderId,
        refund_total_estimated: parsed.refundTotalEstimated,
        refund_destination_text: parsed.refundDestinationText ?? null,
        items: parsed.items,
        status_text: parsed.statusText,
      },
    }
  }

  return {
    eventType: parsed.eventType,
    primaryRef: parsed.orderId,
    amount: parsed.refundAmountIssued,
    occurredAt: email.receivedAt.toISOString(),
    confidence: 1,
    payload: {
      order_id: parsed.orderId,
      refund_amount_issued: parsed.refundAmountIssued,
      refund_destination_text: parsed.refundDestinationText ?? null,
      items: parsed.items,
      status_text: parsed.statusText,
    },
  }
}

function mapManulifeSignal(
  email: IntelligenceEmailInput,
  parsed: Awaited<ReturnType<typeof parseManulifeClaimEmail>>
): StructuredSignal {
  if (!parsed) {
    throw new Error("unexpected null Manulife parse")
  }

  return {
    eventType: parsed.eventType,
    primaryRef: parsed.claimId,
    amount:
      parsed.amounts.amountPaid ??
      parsed.amounts.amountEligible ??
      parsed.amounts.amountClaimed,
    occurredAt: email.receivedAt.toISOString(),
    confidence: parsed.claimId ? 0.99 : 0.9,
    payload: {
      insurer: "Manulife",
      claim_id: parsed.claimId ?? null,
      status_text: parsed.statusText,
      amounts: {
        amount_claimed: parsed.amounts.amountClaimed ?? null,
        amount_eligible: parsed.amounts.amountEligible ?? null,
        amount_paid: parsed.amounts.amountPaid ?? null,
      },
      dates: {
        processed_at: parsed.dates.processedAt ?? null,
        paid_at: parsed.dates.paidAt ?? null,
      },
    },
  }
}
