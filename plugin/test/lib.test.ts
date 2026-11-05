import { describe, expect, it } from "bun:test"
import {
  WORKER_AGENT,
  buildNudge,
  isBusy,
  isConcertoWorker,
  orchestratorPrefix,
  shouldNudge,
  workerDenyRules,
  workerPrefix,
  workerTag,
} from "../src/lib"

describe("workerDenyRules", () => {
  it("denies all concerto tools then allows report", () => {
    const rules = workerDenyRules()
    expect(rules).toHaveLength(2)
    expect(rules[0]).toEqual({ action: "concerto", resource: "*", effect: "deny" })
    expect(rules[1]).toEqual({ action: "concerto", resource: "report", effect: "allow" })
  })
})

describe("shouldNudge", () => {
  it("true for worker in matching directory with parent", () => {
    expect(
      shouldNudge(
        { metadata: workerTag("backend", "/repo/backend"), parentID: "ses_parent", location: { directory: "/repo" } },
        "/repo",
      ),
    ).toBe(true)
  })

  it("false when directory differs", () => {
    expect(
      shouldNudge(
        { metadata: workerTag("backend", "/repo/backend"), parentID: "ses_parent", location: { directory: "/repo" } },
        "/other",
      ),
    ).toBe(false)
  })

  it("false without parentID", () => {
    expect(
      shouldNudge({ metadata: workerTag("backend", "/repo/backend"), location: { directory: "/repo" } }, "/repo"),
    ).toBe(false)
  })

  it("false without worker metadata", () => {
    expect(shouldNudge({ parentID: "ses_parent", location: { directory: "/repo" } }, "/repo")).toBe(false)
    expect(shouldNudge({ metadata: {}, parentID: "ses_parent", location: { directory: "/repo" } }, "/repo")).toBe(false)
    expect(
      shouldNudge(
        { metadata: { concerto: { role: "orchestrator" } }, parentID: "ses_parent", location: { directory: "/repo" } },
        "/repo",
      ),
    ).toBe(false)
  })
})

describe("prefixes", () => {
  it("worker prefix shows the suffix only when it differs from the name", () => {
    expect(workerPrefix("backend", "/repo/backend", "ses_123")).toBe("[concerto:worker backend ses_123]")
    expect(workerPrefix("backend", "/repo/api", "ses_123")).toBe("[concerto:worker backend (api) ses_123]")
    expect(orchestratorPrefix()).toBe("[concerto:orchestrator]")
  })

  it("worker prefix omits the suffix when no directory basename exists", () => {
    expect(workerPrefix("backend", "", "ses_123")).toBe("[concerto:worker backend ses_123]")
  })
})

describe("buildNudge", () => {
  it("first line dedupes the suffix when basename equals the name", () => {
    for (const outcome of ["succeeded", "failed", "interrupted"] as const) {
      expect(
        buildNudge({ name: "backend", sid: "ses_123", directory: "/repo/backend", outcome }),
      ).toBe(`[concerto:event backend ses_123] ${outcome} — collect and review now`)
    }
  })

  it("first line shows the suffix when basename differs from the name", () => {
    expect(buildNudge({ name: "backend", sid: "ses_123", directory: "/repo/api", outcome: "succeeded" })).toBe(
      "[concerto:event backend (api) ses_123] succeeded — collect and review now",
    )
  })

  it("first line omits the suffix when no directory basename exists", () => {
    expect(buildNudge({ name: "w", sid: "ses_1", directory: "", outcome: "succeeded" })).toBe(
      "[concerto:event w ses_1] succeeded — collect and review now",
    )
  })

  it("is the completion signal only — no detail lines even with extra fields", () => {
    const text = buildNudge({
      name: "backend",
      sid: "ses_123",
      directory: "/repo/backend",
      outcome: "failed",
      title: "Fix auth flow",
      tokens: { input: 1200, output: 340 },
      cost: 0.0421,
      changedFiles: ["src/auth.ts", "test/auth.test.ts"],
      reason: "Test suite failed on login",
    } as Parameters<typeof buildNudge>[0])
    expect(text).toBe("[concerto:event backend ses_123] failed — collect and review now")
    expect(text).not.toContain("\n")
  })
})

describe("isBusy", () => {
  it("true when busy is newer than idle", () => {
    expect(isBusy({ busy: 200, idle: 100 })).toBe(true)
  })

  it("true when idle is absent while busy", () => {
    expect(isBusy({ busy: 200 })).toBe(true)
  })

  it("false when idle is newer than busy", () => {
    expect(isBusy({ busy: 100, idle: 200 })).toBe(false)
  })

  it("false when busy equals idle", () => {
    expect(isBusy({ busy: 100, idle: 100 })).toBe(false)
  })

  it("false when both are absent", () => {
    expect(isBusy({})).toBe(false)
    expect(isBusy(undefined)).toBe(false)
  })
})

describe("isConcertoWorker / workerTag roundtrip", () => {
  it("tags and recognizes workers", () => {
    const tag = workerTag("backend", "/repo/backend")
    expect(tag).toEqual({ concerto: { role: "worker", name: "backend", directory: "/repo/backend" } })
    expect(isConcertoWorker(tag)).toBe(true)
  })

  it("recognizes legacy tags without a directory field", () => {
    expect(isConcertoWorker({ concerto: { role: "worker", name: "legacy" } })).toBe(true)
  })

  it("rejects non-worker metadata", () => {
    expect(isConcertoWorker(undefined)).toBe(false)
    expect(isConcertoWorker({})).toBe(false)
    expect(isConcertoWorker({ concerto: {} })).toBe(false)
    expect(isConcertoWorker({ concerto: { role: "orchestrator" } })).toBe(false)
  })
})

describe("WORKER_AGENT", () => {
  it("names the concerto-worker agent", () => {
    expect(WORKER_AGENT).toBe("concerto-worker")
  })
})
