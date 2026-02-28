import { parseOrthodonticsAppointmentEmail } from "./orthodonticsAppointmentParser.js"

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function testScheduledParses(): void {
  const parsed = parseOrthodonticsAppointmentEmail({
    provider: "gmail",
    fromAddress: "info@durhamorthodontics.ca",
    subject: "An Orthodontic Appointment Has Been Scheduled",
    normalizedBody: "Your next appointment has been scheduled.",
  })
  assert(parsed !== null, "scheduled subject should parse")
  assert(parsed?.eventType === "orthodontics.appointment_scheduled", "scheduled event type")
}

function testReminderParses(): void {
  const parsed = parseOrthodonticsAppointmentEmail({
    provider: "gmail",
    fromAddress: "info@durhamorthodontics.ca",
    subject: "Durham Orthodontics: 2 Day Appointment Reminder",
    normalizedBody: "This is a reminder.",
  })
  assert(parsed !== null, "reminder subject should parse")
  assert(parsed?.eventType === "orthodontics.appointment_reminder", "reminder event type")
  assert(parsed?.reminderWindow === "2 Day", "reminder window should parse")
}

function main(): void {
  testScheduledParses()
  testReminderParses()
  console.log("orthodonticsAppointmentParserTest ok")
}

main()
