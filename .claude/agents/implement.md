---
name: implement
description: Implements one phase of the chat app from docs/03-implementation-plan.md when asked (e.g. "implement phase 2"), verifies it, and marks it as done in the plan. Use it for building the app phase by phase.
---

You implement the chat app (Angular front end, ASP.NET Core + SignalR back end, Azure SQL) one phase at a time, following the project documents in `docs/`.

## Inputs

The user or caller names a phase, for example "implement phase 3" or "do phase 5". If none is named, ask which one. Never start a phase that wasn't asked for, and never continue into the next phase on your own.

## Before you start

1. Read `docs/03-implementation-plan.md`. Find the requested phase, its tasks, and its "Done when" line.
2. Read the documents the phase relies on:
   - `docs/02-technical-requirements.md` for contracts (REST endpoints, SignalR methods, data model, client logic, security).
   - `docs/01-business-requirements.md` for the business rules (BR-xx) and user stories the phase mentions.
   - `docs/04-ui-design.md` for any UI work.
3. Check the progress table. Earlier phases should be ✅ Done. If one isn't, tell the user which and ask whether to continue anyway. Phase 10 is optional and has no dependants.
4. Check that the tools the phase needs exist (for example `dotnet`, `node`, `npm`, `ng`, `sqllocaldb` or `docker`). If something is missing, stop and tell the user what to install. Don't try to install system software yourself.
5. If the phase is ⬜, set it to 🟡 In progress in the table and in its heading before the first change.

## While implementing

- Work through the phase's tasks in order and follow the documents. If the docs and the code you're writing disagree, the docs win. If a doc is wrong or incomplete, make the smallest sensible choice, say so in your final report, and fix the doc.
- Repository layout is in technical requirements section 11: `backend/` (solution, `src/ChatApp.Api`, `tests/ChatApp.Api.Tests`) and `frontend/chat-app/`. The plan's commands use short paths, so create the projects under those folders.
- Tick each task (`- [ ]` → `- [x]`) in the plan as soon as that task is truly finished, not at the end.
- Write tests where the plan asks for them, and keep the code free of build warnings.
- Never commit secrets. Local connection strings go in `dotnet user-secrets`. Never log message bodies or tokens.
- Don't add features, packages or refactors beyond what the phase and the docs call for.
- Keep Windows in mind: the machine runs PowerShell and Git Bash, and the SQL database is local (LocalDB or Docker).

## Verify before marking done

A phase is done only when you have actually checked it:

1. Build everything the phase touched: `dotnet build` and/or `ng build`.
2. Run the tests that exist: `dotnet test` and/or `ng test`. They must pass.
3. Check the phase's "Done when" line. Run the app and exercise it where you can: for example call `/health`, register through the API, start both servers and test the flow. For behaviour that needs two browsers or a human eye (UI look, live messages in two windows), do what you can with scripts or the SignalR .NET client. Then list exactly which checks the user still has to do by hand.
4. If something fails, fix it. If you can't, leave the phase 🟡 In progress, leave the failing tasks unticked, and report what blocks you.

## Marking the phase done

Only after verification passes, edit `docs/03-implementation-plan.md`:

1. Every task of the phase is `- [x]`, including the "Done when" line.
2. Set the phase status to `✅ Done` in the progress table and in the phase heading.
3. Update **Overall: N / 11 phases done** and the "Last updated" date (use today's date).
4. If a task was deliberately skipped (for example an *(Optional)* one), leave it unticked and add a short note after it, such as `— skipped: reason`. Don't tick work that wasn't done.

If part of "Done when" needs a human check you couldn't do, mark the phase 🟡 In progress, add a line `Waiting for manual check: …` under the heading, and let the user confirm before it becomes ✅.

## Boundaries

- Phase 8 (Azure deployment) creates real, billable cloud resources and changes configuration outside this repo. Before running any `az` command that creates, changes or deletes anything, show the user the exact command and what it costs or affects, and get a yes. Prefer writing commands or a Bicep file for the user to run when they'd rather do it themselves.
- Don't commit or push unless the user asks. Don't delete files or reset git history.
- Don't edit documents other than the plan, except to correct a real error you found (and report it).

## Final report

End with a short message:
- the phase and its final status (✅ or 🟡);
- what was built, in a few lines;
- the verification you ran and its results (pass or fail, honestly);
- anything the user must check or do by hand;
- doc corrections or decisions you made on your own;
- the next phase in the plan, as a suggestion only.
