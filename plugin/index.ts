import { Plugin } from "@opencode/plugin"
import {
  WORKER_AGENT,
  buildNudge,
  orchestratorPrefix,
  shouldNudge,
  workerDenyRules,
  workerPrefix,
  workerTag,
  type Outcome,
} from "./src/lib"

const PROVENANCE = (sid: string, role: string) => ({
  concerto: { from: sid, role, sid },
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

const workerName = (info: { metadata?: { concerto?: unknown } }): string =>
  typeof info.metadata?.concerto === "object" &&
  info.metadata.concerto !== null &&
  typeof (info.metadata.concerto as { name?: unknown }).name === "string"
    ? (info.metadata.concerto as { name: string }).name
    : "worker"

export default Plugin.define({
  id: "the-cat-concerto",
  async setup(ctx) {
    await ctx.tool.transform((tools) => {
      tools.namespace({ name: "concerto", description: "Headless worker orchestration" })

      tools.add({
        name: "spawn",
        description:
          "Spawn a headless concerto-worker session in a target directory with a task spec. Returns sessionID, name, and attach command.",
        input: schema(
          {
            directory: { type: "string", description: "Absolute or repo-relative target working directory" },
            spec: { type: "string", description: "Self-contained task spec: goal, files, constraints, test command" },
            name: { type: "string", description: "Short worker name; defaults to the directory basename" },
          },
          ["directory", "spec"],
        ),
        options: { namespace: "concerto", codemode: false },
        async execute(raw, context) {
          await assertConcerto(ctx, context, "spawn")
          const input = raw as { directory: string; spec: string; name?: string }
          const own = await ctx.session.get({ sessionID: context.sessionID })
          const name = input.name ?? input.directory.split("/").filter(Boolean).pop() ?? "worker"
          const worker = await ctx.session.create({
            agent: WORKER_AGENT,
            model: own.model,
            location: { directory: input.directory },
            parentID: context.sessionID,
            title: `concerto: ${name}`,
            metadata: workerTag(name),
            permissions: workerDenyRules(),
          })
          await ctx.session.prompt({
            sessionID: worker.id,
            text: `${orchestratorPrefix()}\n${input.spec}`,
            delivery: "queue",
            metadata: PROVENANCE(context.sessionID, "orchestrator"),
          })
          await ctx.session.update({ sessionID: worker.id, archived: true })
          return {
            content: JSON.stringify({
              sessionID: worker.id,
              name,
              attach: `opencode --session ${worker.id}`,
            }),
          }
        },
      })

      tools.add({
        name: "send",
        description:
          "Send a steering message to a worker session. Use steer for mid-turn correction, queue otherwise.",
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
          await ctx.session.prompt({
            sessionID: input.sessionID,
            text: `${orchestratorPrefix()}\n${input.text}`,
            delivery: input.delivery ?? "queue",
            metadata: PROVENANCE(context.sessionID, "orchestrator"),
          })
          return { content: "sent" }
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
          await ctx.session.prompt({
            sessionID: own.parentID,
            text: `${workerPrefix(workerName(own), context.sessionID)}\n${input.text}`,
            delivery: "queue",
            metadata: PROVENANCE(context.sessionID, "worker"),
          })
          return { content: "sent" }
        },
      })

      tools.add({
        name: "collect",
        description:
          "Collect a worker session's outcome: outcome, cost, tokens, title, and the last assistant text.",
        input: schema({ sessionID: { type: "string", description: "Worker session id" } }, ["sessionID"]),
        options: { namespace: "concerto", codemode: false },
        async execute(raw, context) {
          await assertConcerto(ctx, context, "collect")
          const input = raw as { sessionID: string }
          const info = await ctx.session.get({ sessionID: input.sessionID })
          const messages = await ctx.session.context({ sessionID: input.sessionID })
          return {
            content: JSON.stringify({
              outcome: info.outcome,
              cost: info.cost,
              tokens: info.tokens,
              title: info.title,
              lastAssistantText: lastAssistantText(messages),
            }),
          }
        },
      })
    })

    // Event wake: one prompt per finished concerto worker in this location;
    // queue delivery survives a busy orchestrator turn (Review Focus 1).
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({
        types: ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"],
        signal: controller.signal,
      })) {
        try {
          const info = await ctx.session.get({ sessionID: event.data.sessionID })
          if (!shouldNudge(info, ctx.location.directory)) continue
          const outcome = event.type.replace("session.execution.", "") as Outcome
          let changedFiles: string[] | undefined
          try {
            const status = await ctx.vcs.status()
            changedFiles = (Array.isArray(status?.data) ? status.data : [])
              .map((file) => file.file)
              .filter((file) => typeof file === "string")
          } catch {
            // Non-git directory or vcs error: omit the changed line.
          }
          let reason: string | undefined
          if (outcome !== "succeeded") {
            try {
              reason = lastAssistantText(await ctx.session.context({ sessionID: info.id })) || undefined
            } catch {
              // No message history: omit the reason line.
            }
          }
          await ctx.session.prompt({
            sessionID: info.parentID!,
            text: buildNudge({
              name: workerName(info),
              sid: info.id,
              outcome,
              title: info.title,
              tokens: info.tokens,
              cost: info.cost,
              changedFiles,
              reason,
            }),
            delivery: "queue",
            metadata: PROVENANCE(info.id, "event"),
          })
        } catch {
          // A bad event must not kill the wake loop.
        }
      }
    })()
    return () => controller.abort()
  },
})
