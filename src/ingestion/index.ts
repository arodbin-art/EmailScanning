import "dotenv/config"
import { pathToFileURL } from "url"
import { PollOptions, runPoll } from "./pollRunner.js"

export function parsePollArgs(args: string[]): PollOptions {
  const providerFlag = readArg(args, "--provider")
  const limitFlag = readArg(args, "--limit")
  const limit = limitFlag ? Number(limitFlag) : undefined

  return {
    providerFilter: providerFlag ?? undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  }
}

export async function runPollFromCli(
  args: string[],
  runPollImpl: (options: PollOptions) => Promise<void> = runPoll
): Promise<void> {
  const options = parsePollArgs(args)
  await runPollImpl(options)
}

function readArg(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index === -1) {
    return null
  }
  const value = args[index + 1]
  return value ?? null
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  runPollFromCli(process.argv.slice(2))
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error("poll failed", error)
      process.exit(1)
    })
}
