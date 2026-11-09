import { Plugin } from "@opencode/plugin"
import {
  WORKER_AGENT,
  buildNudge,
  concertoTitle,
  isBusy,
  isConcertoWorker,
  isLive,
  lastTurnReported,
  orchestratorPrefix,
  shouldNudge,
  workerDenyRules,
  workerPrefix,
  workerTag,
  worktreeSlug,
  type Outcome,
} from "./src/lib"

// Concerto metadata discriminator: a message carrying
// metadata.concerto.role is ours, not the user's.
const PROVENANCE = (sid: string, role: "worker" | "orchestrator", name?: string, task?: string) => ({
  concerto: { from: sid, role, ...(name ? { name } : {}), ...(task ? { task } : {}) },
})

const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const assertConcerto = (
  ctx: Parameters<NonNullable<Parameters<typeof Plugin.define>[0]["setup"]>>[0],
  context: { sessionID: string; messageID: string; id: string },
  tool: string,
) =>
  ctx.permission.assert({
    sessionID: context.sessionID,
    source: { type: "tool", messageID: context.messageID, id: context.id },
    action: "concerto",
    resources: [tool],
  })

const lastAssistantText = (messages: Array<{ type: string; content?: unknown }>): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type !== "assistant") continue
    const parts = Array.isArray(message.content) ? message.content : []
    const text = parts
      .filter((part): part is { type: string; text: string } => {
        const candidate = part as { type?: unknown; text?: unknown }
        return candidate.type === "text" && typeof candidate.text === "string"
      })
      .map((part) => part.text)
      .join("\n")
    if (text) return text
  }
  return ""
}

type WorkerMeta = { name: string; directory: string; task?: string }

const workerMeta = (info: { metadata?: unknown }): WorkerMeta => {
  const concerto = (info.metadata as { concerto?: unknown } | undefined)?.concerto
  if (typeof concerto !== "object" || concerto === null) return { name: "worker", directory: "" }
  const meta = concerto as { name?: unknown; directory?: unknown; task?: unknown }
  return {
    name: typeof meta.name === "string" ? meta.name : "worker",
    directory: typeof meta.directory === "string" ? meta.directory : "",
    ...(typeof meta.task === "string" ? { task: meta.task } : {}),
  }
}

const ownerError = (sid: string, parentID: string | undefined, caller: string): string =>
  `concerto: worker ${sid} belongs to orchestrator ${parentID ?? "none"}, not ${caller}`

// A worker's owner must be a real orchestrator session: a plain parent or a
// subagent child is not a delivery target. Returns "" when it must not nudge.
const route = (info: { parentID?: string | null; agent?: string }): string =>
  !info.parentID || info.agent === WORKER_AGENT ? "" : info.parentID

const MOVE_DEADLINE_MS = 3000

// session.move lands at the next delivery boundary, so reads right after it can
// still show the pre-move directory. Poll until the target shows up; anything
// else before the deadline is a real failure.
const waitForMove = async (
  ctx: Parameters<NonNullable<Parameters<typeof Plugin.define>[0]["setup"]>>[0],
  sessionID: string,
  directory: string,
) => {
  const deadline = Date.now() + MOVE_DEADLINE_MS
  for (;;) {
    const info = await ctx.session.get({ sessionID })
    if (info.location?.directory === directory || Date.now() >= deadline) return info
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export default Plugin.define({
  id: "the-cat-concerto",
  async setup(ctx) {
    // Every worker this orchestrator owns, live or not.
    const owned = async (orchestratorID: string, directory?: string) => {
      const listed = await ctx.session.list({ parentID: orchestratorID })
      return listed.data.filter(
        (info) => isConcertoWorker(info.metadata) && (!directory || workerMeta(info).directory === directory),
      )
    }

    await ctx.tool.transform((tools) => {
      tools.namespace({ name: "concerto", description: "Headless worker orchestration" })

      tools.add({
        name: "spawn",
        description:
          "Spawn a headless concerto-worker session in a target directory with a task spec. Returns sessionID, name, and attach command. " +
          "Refuses when a live worker for the same directory already exists under you — use concerto_send on that session instead. " +
          "Pass parallel: true only for genuine parallel work in one directory. " +
          "worktree: true creates a git worktree in your own project and spawns the worker there — create-only, concerto never removes it (the human runs wt remove); " +
          "cross-repo spawns pass an absolute directory without the flag. " +
          "name defaults to the directory basename and is stable identity; task is a short task id shown in the title only.",
        input: schema(
          {
            directory: { type: "string", description: "Absolute or repo-relative target working directory" },
            spec: { type: "string", description: "Self-contained task spec: goal, files, constraints, test command" },
            task: { type: "string", description: "Short task id (e.g. am06-policy). Title only, not identity." },
            parallel: { type: "boolean", description: "Allow a second live worker in the same directory (default false)" },
            worktree: { type: "boolean", description: "Create a git worktree in your own project and spawn there (default false)" },
            branch: { type: "string", description: "Worktree branch slug override (defaults to the task id)" },
          },
          ["directory", "spec"],
        ),
        options: { namespace: "concerto", codemode: false },
        async execute(raw, context) {
          await assertConcerto(ctx, context, "spawn")
          const input = raw as {
            directory: string
            spec: string
            task?: string
            parallel?: boolean
            worktree?: boolean
            branch?: string
          }
          const own = await ctx.session.get({ sessionID: context.sessionID })
          let directory = input.directory.startsWith("/")
            ? input.directory
            : `${(own.location?.directory ?? ctx.location.directory).replace(/\/+$/, "")}/${input.directory}`
          let name = directory.split("/").filter(Boolean).pop() ?? "worker"
          if (input.worktree) {
            const slug = worktreeSlug(input.branch ?? input.task, name)
            const projectID = ctx.location.project?.id
            if (!ctx.worktree?.create || !projectID) {
              return {
                content:
                  "concerto: worktree create unavailable — this session has no worktree API or project context; spawn without worktree or pass an absolute directory",
              }
            }
            try {
              const created = await ctx.worktree.create({ projectID, name: slug })
              directory = created.directory
              name = `wt-${slug}`
            } catch (error) {
              return {
                content: `concerto: worktree create failed: ${error instanceof Error ? error.message : String(error)}`,
              }
            }
          }
          if (!input.parallel) {
            const existing = (await owned(context.sessionID, directory)).find((info) => isLive(info.outcome))
            if (existing) {
              return {
                content: `concerto: live worker ${existing.id} already exists for ${directory} — use concerto_send for follow-up work, or parallel: true for genuine parallel work`,
              }
            }
          }
          const worker = await ctx.session.create({
            agent: WORKER_AGENT,
            model: own.model,
            location: { directory },
            parentID: context.sessionID,
            title: concertoTitle(name, input.task),
            metadata: workerTag(name, directory, input.task),
            permissions: workerDenyRules(),
          })
          // The per-location plugin instance ignores create's location — move
          // explicitly, confirm it landed, THEN prompt: a prompt before the
          // move lets the worker's first turn run without its spec.
          await ctx.session.move({ sessionID: worker.id, directory })
          const landed = await waitForMove(ctx, worker.id, directory)
          if (landed.location?.directory !== directory) {
            // A session left unspecced would stay "live" and trip the
            // duplicate gate on the next attempt.
            await ctx.session.update({ sessionID: worker.id, archived: true })
            return {
              content: `concerto: session ${worker.id} did not move to ${directory} (at ${landed.location?.directory ?? "unknown"}) — no spec sent, no turn started, session archived`,
            }
          }
          await ctx.session.synthetic({
            sessionID: worker.id,
            text: `${orchestratorPrefix()}\n${input.spec}`,
            delivery: "steer",
            metadata: PROVENANCE(context.sessionID, "orchestrator"),
          })
          await ctx.session.update({ sessionID: worker.id, archived: true })
          return {
            content: JSON.stringify({
              sessionID: worker.id,
              name,
              task: input.task,
              directory,
              attach: `opencode --session ${worker.id}`,
            }),
          }        },
      })

      tools.add({
        name: "workers",
        description:
          "List the concerto workers you own, optionally filtered by directory: name, task, sessionID, directory, busy, outcome. " +
          "Call this before spawning — a live worker for the directory gets concerto_send, never a second spawn.",
        input: schema({ directory: { type: "string", description: "Only workers in this directory" } }, []),
        options: { namespace: "concerto", codemode: false },
        async execute(raw, context) {
          await assertConcerto(ctx, context, "workers")
          const input = raw as { directory?: string }
          const entries = (await owned(context.sessionID, input.directory)).map((info) => {
            const meta = workerMeta(info)
            return {
              name: meta.name,
              task: meta.task,
              sessionID: info.id,
              directory: meta.directory || info.location?.directory,
              busy: isBusy(info.time),
              outcome: info.outcome,
            }
          })
          return { content: JSON.stringify(entries) }
        },
      })

      tools.add({
        name: "send",
        description:
          "Send a steering message to a worker session. Use steer for mid-turn correction, queue otherwise. Only the worker's owning orchestrator may send.",
        input: schema(
          {
            sessionID: { type: "string", description: "Worker session id" },
            text: { type: "string", description: "Message text" },
            delivery: { type: "string", enum: ["steer", "queue"] },
          },
          ["sessionID", "text"],
        ),
        options: { namespace: "concerto", codemode: false },
        async execute(raw, context) {
          await assertConcerto(ctx, context, "send")
          const input = raw as { sessionID: string; text: string; delivery?: "steer" | "queue" }
          const delivery = input.delivery ?? "queue"
          const info = await ctx.session.get({ sessionID: input.sessionID })
          if (info.parentID !== context.sessionID) {
            return { content: ownerError(input.sessionID, info.parentID, context.sessionID) }
          }
          await ctx.session.synthetic({
            sessionID: input.sessionID,
            text: `${orchestratorPrefix()}\n${input.text}`,
            delivery,
            metadata: PROVENANCE(context.sessionID, "orchestrator"),
          })
          return { content: JSON.stringify({ sessionID: input.sessionID, delivery, busy: isBusy(info.time) }) }
        },
      })

      tools.add({
        name: "kill",
        description:
          "End a worker session you own: interrupts a running turn, then deletes the session. Only the worker's owning orchestrator may kill.",
        input: schema({ sessionID: { type: "string", description: "Worker session id" } }, ["sessionID"]),
        options: { namespace: "concerto", codemode: false },
        async execute(raw, context) {
          await assertConcerto(ctx, context, "kill")
          const input = raw as { sessionID: string }
          const info = await ctx.session.get({ sessionID: input.sessionID })
          if (info.parentID !== context.sessionID) {
            return { content: ownerError(input.sessionID, info.parentID, context.sessionID) }
          }
          const interrupted = isBusy(info.time)
          if (interrupted) await ctx.session.interrupt({ sessionID: input.sessionID })
          await ctx.session.remove({ sessionID: input.sessionID })
          return { content: JSON.stringify({ sessionID: input.sessionID, killed: true, interrupted }) }
        },
      })

      tools.add({
        name: "report",
        description: "Worker-only: report a blocker or decision need to the parent orchestrator session.",
        input: schema({ text: { type: "string", description: "Report text" } }, ["text"]),
        options: { namespace: "concerto", codemode: false },
        async execute(raw, context) {
          await assertConcerto(ctx, context, "report")
          const input = raw as { text: string }
          const own = await ctx.session.get({ sessionID: context.sessionID })
          if (!own.parentID) {
            return { content: "concerto_report: session has no parent orchestrator" }
          }
          const meta = workerMeta(own)
          await ctx.session.synthetic({
            sessionID: own.parentID,
            text: `${workerPrefix(meta.name, meta.directory, context.sessionID, meta.task)}\n${input.text}`,
            delivery: "steer",
            metadata: PROVENANCE(context.sessionID, "worker", meta.name, meta.task),
          })
          return { content: "sent" }
        },
      })

      tools.add({
        name: "collect",
        description:
          "Collect a worker session's outcome: outcome, cost, tokens, title, and the last assistant text. Only the worker's owning orchestrator may collect.",
        input: schema({ sessionID: { type: "string", description: "Worker session id" } }, ["sessionID"]),
        options: { namespace: "concerto", codemode: false },
        async execute(raw, context) {
          await assertConcerto(ctx, context, "collect")
          const input = raw as { sessionID: string }
          const info = await ctx.session.get({ sessionID: input.sessionID })
          if (info.parentID !== context.sessionID) {
            return { content: ownerError(input.sessionID, info.parentID, context.sessionID) }
          }
          const messages = await ctx.session.context({ sessionID: input.sessionID })
          return {
            content: JSON.stringify({
              outcome: info.outcome,
              cost: info.cost,
              tokens: info.tokens,
              title: info.title,
              directory: info.location?.directory,
              busy: isBusy(info.time),
              lastAssistantText: lastAssistantText(messages),
            }),
          }
        },
      })
    })

    // Event wake: one message per finished concerto worker, delivered to the
    // worker's owning orchestrator (info.parentID) — never broadcast. A
    // per-location plugin instance has no handle on its own orchestrator
    // session, so the owner is resolved from the worker; `route` states the
    // accepted owner only for workers whose parent is a real orchestrator
    // session, and delivery goes to that same parent. Steer delivery lands
    // even inside a busy turn.
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({
        types: ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"],
        signal: controller.signal,
      })) {
        try {
          const info = await ctx.session.get({ sessionID: event.data.sessionID })
          // Delivery target is info.parentID, so the owning orchestrator is
          // resolved from the worker, not guessed by this instance. `route`
          // decides whether that owner is reachable at all.
          const owner = route(info)
          if (!shouldNudge(info, owner)) continue
          const outcome = event.type.replace("session.execution.", "") as Outcome
          let messages: Awaited<ReturnType<typeof ctx.session.context>> = []
          try {
            messages = await ctx.session.context({ sessionID: info.id })
            if (lastTurnReported(messages)) continue
          } catch {
            // No history readable: fall through and send the nudge.
          }
          const meta = workerMeta(info)
          const tail = lastAssistantText(messages).trim().slice(-300)
          await ctx.session.synthetic({
            sessionID: owner,
            text: [
              buildNudge({ name: meta.name, sid: info.id, directory: meta.directory, outcome }),
              `cost $${info.cost.toFixed(4)} · tokens ${info.tokens.input}/${info.tokens.output}`,
              ...(tail ? [tail] : []),
            ].join("\n"),
            delivery: "steer",
            metadata: PROVENANCE(info.id, "worker", meta.name, meta.task),
          })
        } catch {
          // A bad event must not kill the wake loop.
        }
      }
    })()
    return () => controller.abort()
  },
})
