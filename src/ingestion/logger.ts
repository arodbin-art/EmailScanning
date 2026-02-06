import { Logger } from "./types.js"

export const consoleLogger: Logger = {
  info(message, fields) {
    console.log(JSON.stringify({ level: "info", message, ...fields }))
  },
  warn(message, fields) {
    console.warn(JSON.stringify({ level: "warn", message, ...fields }))
  },
  error(message, fields) {
    console.error(JSON.stringify({ level: "error", message, ...fields }))
  },
}
