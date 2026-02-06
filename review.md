There are functional issues that can cause the poller to fail in environments without AI credentials and to run twice when RUN_POLL_ON_START is enabled, leading to duplicate ingestion.

Full review comments:

- [P2] Avoid failing polls when AI is intentionally unset — /media/nas/workspaces/EmailScanning/src/ingestion/pollRunner.ts:20-31
  `createAiClient()` throws if `OPENAI_API_KEY` is missing, but `EmailIngestionService` treats the AI client as optional and already logs/marks monitors when it is absent. As written, any poll will crash in environments without OpenAI credentials (even if there are no AI-backed monitors), which prevents basic ingestion from running. Consider gating client creation on an opt-in env flag or returning `undefined` when AI is not configured.

- [P2] Prevent double polling when RUN_POLL_ON_START is true — /media/nas/workspaces/EmailScanning/src/ingestion/pollRunner.ts:127-133
  `pollRunner.ts` auto-invokes `runPoll()` on import when `RUN_POLL_ON_START=true`, but `ingestion/index.ts` also calls `runPoll()` unconditionally. Running `node dist/ingestion/index.js` with that env var set will execute the poll twice, causing duplicate ingestion and duplicate side effects. Consider removing the auto-run or gating it so the CLI entrypoint does not trigger it twice.

## Handoff
See HANDOFF.md for current state, progress, and next steps.
