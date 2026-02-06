import "dotenv/config"
import { runPoll } from "./pollRunner.js"

const args = process.argv.slice(2)
const providerFlag = readArg(args, "--provider")
const limitFlag = readArg(args, "--limit")
const limit = limitFlag ? Number(limitFlag) : undefined

runPoll({
  providerFilter: providerFlag ?? undefined,
  limit: Number.isFinite(limit) ? limit : undefined,
})
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error("poll failed", error)
    process.exit(1)
  })

function readArg(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index === -1) {
    return null
  }
  const value = args[index + 1]
  return value ?? null
}
