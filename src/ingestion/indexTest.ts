import { parsePollArgs, runPollFromCli } from "./index.js"

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

async function testParseArgs() {
  const parsed = parsePollArgs(["--provider", "gmail", "--limit", "20"])
  assert(parsed.providerFilter === "gmail", "provider should parse")
  assert(parsed.limit === 20, "limit should parse")

  const parsedWithoutLimit = parsePollArgs(["--provider", "microsoft", "--limit", "abc"])
  assert(parsedWithoutLimit.providerFilter === "microsoft", "provider should parse when limit invalid")
  assert(parsedWithoutLimit.limit === undefined, "invalid limit should become undefined")
}

async function testRunSingleInvocation() {
  const calls: Array<{ providerFilter?: string; limit?: number }> = []
  await runPollFromCli(
    ["--provider", "gmail", "--limit", "10"],
    async (options) => {
      calls.push(options)
    }
  )
  assert(calls.length === 1, "CLI entrypoint should invoke runPoll exactly once")
  assert(calls[0].providerFilter === "gmail", "provider should pass through to runPoll")
  assert(calls[0].limit === 10, "limit should pass through to runPoll")
}

async function main() {
  await testParseArgs()
  await testRunSingleInvocation()
  console.log("ingestion index tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
