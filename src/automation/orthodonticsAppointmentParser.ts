import { ORTHODONTICS_EVENT_TYPES } from "../events/signalEvents.js"

export type OrthodonticsAppointmentEmailInput = {
  provider: string
  fromAddress: string
  subject?: string
  receivedAt?: Date
  normalizedBody: string
}

export type OrthodonticsAppointmentParseResult = {
  eventType:
    | typeof ORTHODONTICS_EVENT_TYPES.APPOINTMENT_SCHEDULED
    | typeof ORTHODONTICS_EVENT_TYPES.APPOINTMENT_REMINDER
  clinic: string
  statusText: string
  reminderWindow?: string
}

const DURHAM_SENDER = /\binfo@durhamorthodontics\.ca\b/i
const SUBJECT_SCHEDULED = /an orthodontic appointment has been scheduled/i
const SUBJECT_REMINDER = /durham orthodontics:\s*(.+?)\s+appointment reminder/i

export function parseOrthodonticsAppointmentEmail(
  input: OrthodonticsAppointmentEmailInput
): OrthodonticsAppointmentParseResult | null {
  void input.provider
  void input.receivedAt
  void input.normalizedBody
  if (!DURHAM_SENDER.test(input.fromAddress)) {
    return null
  }
  const subject = (input.subject ?? "").trim()
  if (!subject) {
    return null
  }

  if (SUBJECT_SCHEDULED.test(subject)) {
    return {
      eventType: ORTHODONTICS_EVENT_TYPES.APPOINTMENT_SCHEDULED,
      clinic: "Durham Orthodontics",
      statusText: "Appointment scheduled",
    }
  }

  const reminderMatch = subject.match(SUBJECT_REMINDER)
  if (reminderMatch) {
    return {
      eventType: ORTHODONTICS_EVENT_TYPES.APPOINTMENT_REMINDER,
      clinic: "Durham Orthodontics",
      statusText: "Appointment reminder",
      reminderWindow: reminderMatch[1]?.trim() || undefined,
    }
  }

  return null
}
