import { describe, expect, it } from "bun:test"
import {
  WORKER_AGENT,
  isConcertoWorker,
  nudgeText,
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
        { metadata: workerTag("backend"), parentID: "ses_parent", location: { directory: "/repo" } },
        "/repo",
      ),
    ).toBe(true)
  })

  it("false when directory differs", () => {
    expect(
      shouldNudge(
        { metadata: workerTag("backend"), parentID: "ses_parent", location: { directory: "/repo" } },
        "/other",
      ),
    ).toBe(false)
  })

  it("false without parentID", () => {
    expect(
      shouldNudge({ metadata: workerTag("backend"), location: { directory: "/repo" } }, "/repo"),
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
  it("worker/orchestrator/event formats", () => {
    expect(workerPrefix("backend", "ses_123")).toBe("[concerto:worker backend ses_123]")
    expect(orchestratorPrefix()).toBe("[concerto:orchestrator]")
    expect(nudgeText("backend", "ses_123", "succeeded")).toBe(
      "[concerto:event backend ses_123] succeeded — collect and review now",
    )
    expect(nudgeText("backend", "ses_123", "failed")).toBe(
      "[concerto:event backend ses_123] failed — collect and review now",
    )
    expect(nudgeText("backend", "ses_123", "interrupted")).toBe(
      "[concerto:event backend ses_123] interrupted — collect and review now",
    )
  })
})

describe("isConcertoWorker / workerTag roundtrip", () => {
  it("tags and recognizes workers", () => {
    const tag = workerTag("backend")
    expect(tag).toEqual({ concerto: { role: "worker", name: "backend" } })
    expect(isConcertoWorker(tag)).toBe(true)
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
