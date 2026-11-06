import { describe, expect, it } from "bun:test"
import plugin from "../index"
import { WORKER_AGENT } from "../src/lib"

// ============================================
// Fake Plugin Context
// ============================================

type Tool = {
  name: string
  description: string
  execute: (input: unknown, context: { sessionID: string; messageID: string; id: string }) => Promise<{ content: string }>
}

const ORCHESTRATOR = "ses_orchestrator"

// Records every session API call in order and serves just enough state for
// spawn to run. `directory` is where move actually lands the session.
// `moveLag` simulates the projected move: the first N reads after a move keep
// returning the pre-move location.
function harness(
  options: {
    landIn?: string
    moveLag?: number
    siblings?: Array<Record<string, unknown>>
    events?: Array<{ type: string; data: { sessionID: string } }>
  } = {},
) {
  const calls: string[] = []
  const sessions = new Map<string, Record<string, any>>([
    [
      ORCHESTRATOR,
      {
        id: ORCHESTRATOR,
        parentID: undefined,
        location: { directory: "/repo" },
        model: { providerID: "p", id: "m" },
        time: { created: 0, updated: 0 },
      },
    ],
  ])
  const tools: Tool[] = []
  const pending = new Map<string, { directory: string; lag: number }>()
  let created = 0

  const ctx: any = {
    location: { directory: "/repo" },
    permission: { assert: async () => undefined },
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {
          for (const event of options.events ?? []) yield event
        },
      }),
    },
    tool: {
      transform: async (callback: (editor: unknown) => Promise<void>) => {
        await callback({
          namespace: () => undefined,
          add: (tool: Tool) => tools.push(tool),
        })
      },
    },
    session: {
      list: async ({ parentID }: { parentID?: string } = {}) => ({
        data: (options.siblings ?? []).filter((row) => !parentID || row.parentID === parentID),
        cursor: {},
      }),
      create: async (input: Record<string, any>) => {
        calls.push("create")
        const id = `ses_worker${++created}`
        // A lagging harness starts the worker at the parent directory, like the
        // real create that ignores its location.
        const location = options.moveLag ? { directory: "/repo" } : input.location
        sessions.set(id, { ...input, id, location, time: { created: 0, updated: 0 } })
        return sessions.get(id)
      },
      get: async ({ sessionID }: { sessionID: string }) => {
        calls.push("get")
        const info = sessions.get(sessionID) ?? { id: sessionID, location: { directory: "/repo/api" } }
        const move = pending.get(sessionID)
        if (move && move.lag > 0) {
          move.lag -= 1
          return info
        }
        if (move) {
          info.location = { directory: move.directory }
          pending.delete(sessionID)
        }
        return info
      },
      move: async ({ sessionID, directory }: { sessionID: string; directory: string }) => {
        calls.push("move")
        pending.set(sessionID, { directory: options.landIn ?? directory, lag: options.moveLag ?? 0 })
      },
      synthetic: async (input: { sessionID: string }) => {
        calls.push("synthetic")
        return { id: "msg", sessionID: input.sessionID, type: "synthetic", time: { created: 0 }, payload: {}, delivery: "steer" }
      },
      prompt: async () => {
        calls.push("prompt")
        throw new Error("spawn must not use session.prompt")
      },
      update: async () => {
        calls.push("archive")
      },
      context: async () => [],
    },
  }

  return { ctx, calls, tools, sessions }
}

const tool = (tools: Tool[], name: string): Tool => {
  const found = tools.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`tool ${name} missing`)
  return found
}

const caller = { sessionID: ORCHESTRATOR, messageID: "msg_1", id: "tool_1" }
const ok = { type: "allow" as const }

// ============================================
// Spawn Ordering
// ============================================

describe("spawn ordering", () => {
  it("moves, verifies the move, then enqueues the spec — never prompting first", async () => {
    const { ctx, calls, tools } = harness()
    await plugin.setup(ctx)
    const result = await tool(tools, "spawn").execute(
      { directory: "api", spec: "do the thing", task: "am06-policy" },
      caller,
    )

    // Leading get is the caller's own session lookup, before any create.
    expect(calls).toEqual(["get", "create", "move", "get", "synthetic", "archive"])
    expect(calls.indexOf("move")).toBeLessThan(calls.indexOf("synthetic"))
    expect(calls.indexOf("get")).toBeLessThan(calls.indexOf("synthetic"))
    expect(JSON.parse(result.content)).toMatchObject({ name: "api", task: "am06-policy", directory: "/repo/api" })
  })

  it("keeps title, metadata, and permissions on the created session", async () => {
    const { ctx, tools, sessions } = harness()
    await plugin.setup(ctx)
    await tool(tools, "spawn").execute({ directory: "/repo/api", spec: "spec", task: "am06" }, caller)

    const worker = sessions.get("ses_worker1")!
    expect(worker.title).toBe("concerto: api — am06")
    expect(worker.metadata).toEqual({ concerto: { role: "worker", name: "api", directory: "/repo/api", task: "am06" } })
    expect(worker.permissions[0]).toEqual({ action: "concerto", resource: "*", effect: "deny" })
    expect(worker.parentID).toBe(ORCHESTRATOR)
  })

  it(
    "sends no spec and no turn when the move did not land",
    async () => {
      const { ctx, calls, tools } = harness({ landIn: "/elsewhere" })
      await plugin.setup(ctx)
      const result = await tool(tools, "spawn").execute({ directory: "/repo/api", spec: "spec" }, caller)

      // Polls the full deadline, so the get count varies with machine speed.
      expect(calls.at(-1)).toBe("archive")
      expect(calls).toContain("move")
      expect(calls).not.toContain("synthetic")
      expect(result.content).toContain("did not move to /repo/api")
      expect(result.content).toContain("session archived")
    },
    10_000,
  )

  it("waits out a lagging move projection before sending the spec", async () => {
    const { ctx, calls, tools } = harness({ moveLag: 2 })
    await plugin.setup(ctx)
    const result = await tool(tools, "spawn").execute({ directory: "/repo/api", spec: "spec" }, caller)

    expect(calls).toEqual(["get", "create", "move", "get", "get", "get", "synthetic", "archive"])
    expect(JSON.parse(result.content)).toMatchObject({ sessionID: "ses_worker1", directory: "/repo/api" })
  })

  it("title omits the task when none is given", async () => {
    const { ctx, tools, sessions } = harness()
    await plugin.setup(ctx)
    await tool(tools, "spawn").execute({ directory: "/repo/api", spec: "spec" }, caller)
    expect(sessions.get("ses_worker1")!.title).toBe("concerto: api")
  })
})

// ============================================
// Duplicate Gate And Ownership
// ============================================

const workerRow = (id: string, directory: string, outcome?: string) => ({
  id,
  parentID: ORCHESTRATOR,
  location: { directory },
  metadata: { concerto: { role: "worker", name: directory.split("/").pop(), directory } },
  time: { created: 0, updated: 0, busy: 0, idle: 1 },
  ...(outcome ? { outcome } : {}),
})

describe("duplicate-spawn gate", () => {
  it("refuses when a live worker exists for the directory", async () => {
    const { ctx, calls, tools } = harness({ siblings: [workerRow("ses_live", "/repo/api")] })
    await plugin.setup(ctx)
    const result = await tool(tools, "spawn").execute({ directory: "/repo/api", spec: "spec" }, caller)

    expect(calls).toEqual(["get"])
    expect(result.content).toContain("ses_live")
    expect(result.content).toContain("concerto_send")
  })

  it("allows a spawn when the existing worker failed", async () => {
    const { ctx, tools } = harness({ siblings: [workerRow("ses_dead", "/repo/api", "failed")] })
    await plugin.setup(ctx)
    const result = await tool(tools, "spawn").execute({ directory: "/repo/api", spec: "spec" }, caller)
    expect(JSON.parse(result.content).sessionID).toBe("ses_worker1")
  })

  it("allows a spawn with parallel: true", async () => {
    const { ctx, tools } = harness({ siblings: [workerRow("ses_live", "/repo/api")] })
    await plugin.setup(ctx)
    const result = await tool(tools, "spawn").execute({ directory: "/repo/api", spec: "spec", parallel: true }, caller)
    expect(JSON.parse(result.content).sessionID).toBe("ses_worker1")
  })

  it("ignores workers in other directories", async () => {
    const { ctx, tools } = harness({ siblings: [workerRow("ses_live", "/repo/web")] })
    await plugin.setup(ctx)
    const result = await tool(tools, "spawn").execute({ directory: "/repo/api", spec: "spec" }, caller)
    expect(JSON.parse(result.content).sessionID).toBe("ses_worker1")
  })
})

describe("owner binding", () => {
  const spawn = async (handler: string, outcome?: string) => {
    const row = { ...workerRow("ses_w", "/repo/api", outcome), parentID: "ses_other" }
    const { ctx, calls, tools, sessions } = harness({ siblings: [row] })
    sessions.set("ses_w", row)
    await plugin.setup(ctx)
    const input = handler === "send" ? { sessionID: "ses_w", text: "x" } : { sessionID: "ses_w" }
    const result = await tool(tools, handler).execute(input, caller)
    return { result, calls }
  }

  it("refuses send from a non-owner", async () => {
    const { result, calls } = await spawn("send")
    expect(result.content).toBe("concerto: worker ses_w belongs to orchestrator ses_other, not ses_orchestrator")
    expect(calls).not.toContain("synthetic")
  })

  it("refuses collect from a non-owner", async () => {
    const { result } = await spawn("collect")
    expect(result.content).toContain("belongs to orchestrator ses_other")
  })
})

// A worker session that the owning orchestrator can drive.
const ownedWorker = (parentID: string) => ({
  id: "ses_w",
  parentID,
  location: { directory: "/repo/api" },
  metadata: { concerto: { role: "worker", name: "api", directory: "/repo/api" } },
  time: { created: 0, updated: 0 },
})

describe("owners can drive their worker", () => {
  it("send enqueues a synthetic orchestrator message", async () => {
    const { ctx, calls, tools, sessions } = harness()
    sessions.set("ses_w", ownedWorker(ORCHESTRATOR))
    const synthetic: Array<Record<string, unknown>> = []
    ctx.session.synthetic = async (input: Record<string, unknown>) => {
      calls.push("synthetic")
      synthetic.push(input)
    }
    await plugin.setup(ctx)
    await tool(tools, "send").execute({ sessionID: "ses_w", text: "steer me", delivery: "steer" }, caller)

    expect(synthetic).toHaveLength(1)
    expect(synthetic[0]).toMatchObject({
      sessionID: "ses_w",
      delivery: "steer",
      metadata: { concerto: { from: ORCHESTRATOR, role: "orchestrator" } },
    })
    expect(String(synthetic[0].text)).toStartWith("[concerto:orchestrator]")
  })

  it("report enqueues a synthetic worker-role message to the parent", async () => {
    const { ctx, calls, tools, sessions } = harness()
    sessions.set("ses_w", ownedWorker(ORCHESTRATOR))
    const synthetic: Array<Record<string, unknown>> = []
    ctx.session.synthetic = async (input: Record<string, unknown>) => {
      calls.push("synthetic")
      synthetic.push(input)
    }
    await plugin.setup(ctx)
    await tool(tools, "report").execute({ text: "blocked" }, { ...caller, sessionID: "ses_w" })

    expect(synthetic[0]).toMatchObject({
      sessionID: ORCHESTRATOR,
      delivery: "steer",
      metadata: { concerto: { from: "ses_w", role: "worker", name: "api" } },
    })
    expect(String(synthetic[0].text)).toStartWith("[concerto:worker api ses_w]")
  })

  it("workers lists only this orchestrator's workers", async () => {
    const { ctx, tools } = harness({
      siblings: [workerRow("ses_mine", "/repo/api"), { ...workerRow("ses_theirs", "/repo/api"), parentID: "ses_other" }],
    })
    await plugin.setup(ctx)
    const result = await tool(tools, "workers").execute({}, caller)
    const entries = JSON.parse(result.content)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: "api", sessionID: "ses_mine", directory: "/repo/api", busy: false })
    expect(entries[0]).not.toHaveProperty("lastAssistantText")
  })
})

// ============================================
// Wake Loop Routing
// ============================================

// setup() starts the wake loop asynchronously; let it drain the fake events.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const finished = (sid: string) => [{ type: "session.execution.succeeded", data: { sessionID: sid } }]

describe("wake loop routing", () => {
  const run = async (agent: string | undefined, parentID: string | undefined) => {
    const rows: Array<Record<string, unknown>> = [
      {
        id: "ses_done",
        parentID,
        agent,
        location: { directory: "/repo/api" },
        metadata: { concerto: { role: "worker", name: "api", directory: "/repo/api" } },
        time: { created: 0, updated: 0 },
        cost: 0.5,
        tokens: { input: 10, output: 2 },
      },
    ]
    const { ctx, sessions } = harness({ siblings: rows, events: finished("ses_done") })
    for (const row of rows) sessions.set(String(row.id), row)
    const nudges: Array<Record<string, unknown>> = []
    ctx.session.synthetic = async (input: Record<string, unknown>) => {
      nudges.push(input)
    }
    ctx.session.context = async () => []
    await plugin.setup(ctx)
    await settle()
    return nudges
  }

  it("nudges the worker's owning orchestrator, carrying the payload", async () => {
    const nudges = await run("build", ORCHESTRATOR)
    expect(nudges).toHaveLength(1)
    expect(nudges[0]).toMatchObject({ sessionID: ORCHESTRATOR, delivery: "steer" })
    expect(String(nudges[0].text)).toContain("[concerto:event api ses_done] succeeded")
    expect(String(nudges[0].text)).toContain("tokens 10/2")
  })

  it("never nudges when the parent is another worker (subagent child)", async () => {
    expect(await run(WORKER_AGENT, "ses_other_worker")).toHaveLength(0)
  })

  it("never nudges a worker with no parent", async () => {
    expect(await run("build", undefined)).toHaveLength(0)
  })
})
