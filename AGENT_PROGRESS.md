ADDITIONAL AGENT INSTRUCTION — PROGRESS TRACKING & TASK MANAGEMENT

Apply this instruction to the Signal Engine project.

---

## PROGRESS.md Requirement

The agent must create and maintain a file named PROGRESS.md at the root of the repository.

This file is the authoritative execution log for the project.

---

## Initial PROGRESS.md Creation

On project start, the agent must:

1. Create PROGRESS.md if it does not exist.
2. Populate it with:
   - Project name
   - Execution start timestamp
   - High-level objective summary
   - The full ordered task list from the “Implementation order” section of the project prompt

Tasks must be written as a checklist using markdown task syntax:

- [ ] Task name

---

## Ongoing Update Rules

The agent must update PROGRESS.md continuously.

### When a task starts

- Mark the task as “In Progress”.
- Add a timestamp.
- Briefly describe what is being worked on.

### When a task completes

- Check the task:
  - [x] Task name
- Add:
  - Completion timestamp
  - Short summary of what was implemented
  - Relevant files or migrations created

---

## Handling New or Changed Tasks

If, during implementation, the agent determines that:

- A task must be split
- A new prerequisite task is required
- The original task order must change
- A previously undefined task is discovered

Then the agent must:

1. Update PROGRESS.md immediately.
2. Add the new task(s) to the checklist.
3. Clearly label them as:
   - “Added during execution”
4. Explain why the change was required.

The agent must not silently change scope.

---

## Error and Blocker Logging

If progress is blocked:

- Log a “Blocked” section under the active task.
- Describe:
  - What is blocked
  - Why
  - What information or decision is needed

---

## Resume Capability

PROGRESS.md must be written so that:

- Another agent
- Or the same agent at a later time

Can resume work with no additional context.

---

## Non-negotiable Rules

- PROGRESS.md must be updated before moving to the next task.
- No task may be checked off without corresponding implementation.
- No implementation may occur without a corresponding task entry.
- PROGRESS.md must reflect reality at all times.

---

## Enforcement

If the agent completes work without updating PROGRESS.md, this is a failure of instructions.

---

END OF INSTRUCTION


## Handoff
See HANDOFF.md for current state, progress, and next steps.
