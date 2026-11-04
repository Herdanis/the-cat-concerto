export type Outcome = "succeeded" | "failed" | "interrupted"

export const WORKER_AGENT = "concerto-worker"

export type WorkerTag = {
  concerto: {
    role: "worker"
    name: string
  }
}

export function workerTag(name: string): WorkerTag {
  return { concerto: { role: "worker", name } }
}

export function isConcertoWorker(meta: unknown): boolean {
  return (
    typeof meta === "object" &&
    meta !== null &&
    (meta as { concerto?: unknown }).concerto !== null &&
    typeof (meta as { concerto?: { role?: unknown } }).concerto === "object" &&
    (meta as { concerto: { role?: unknown } }).concerto.role === "worker"
  )
}

export interface NudgeInfo {
  metadata?: unknown
  parentID?: string | null
  location?: { directory?: string }
}

export function shouldNudge(info: NudgeInfo, ownDirectory: string): boolean {
  return (
    isConcertoWorker(info.metadata) &&
    typeof info.parentID === "string" &&
    info.parentID !== "" &&
    info.location?.directory === ownDirectory
  )
}

export interface PermissionRule {
  action: string
  resource: string
  effect: "allow" | "deny"
}

// Deny-all first, then allow report: last match wins, so workers may
// report blockers but never spawn, steer, or collect.
export function workerDenyRules(): PermissionRule[] {
  return [
    { action: "concerto", resource: "*", effect: "deny" },
    { action: "concerto", resource: "report", effect: "allow" },
  ]
}

export function workerPrefix(name: string, sid: string): string {
  return `[concerto:worker ${name} ${sid}]`
}

export function orchestratorPrefix(): string {
  return "[concerto:orchestrator]"
}

export interface NudgeInput {
  name: string
  sid: string
  outcome: Outcome
  title?: string
  tokens?: { input?: number; output?: number }
  cost?: unknown
  changedFiles?: string[]
  reason?: string
}

export function buildNudge(input: NudgeInput): string {
  const lines = [
    `[concerto:event ${input.name} ${input.sid}] ${input.outcome} — collect and review now`,
  ]
  const segments: string[] = []
  if (input.title) segments.push(`task: ${input.title}`)
  if (typeof input.tokens?.input === "number" || typeof input.tokens?.output === "number") {
    segments.push(`tokens: ${input.tokens?.input ?? 0} in / ${input.tokens?.output ?? 0} out`)
  }
  if (typeof input.cost === "number") segments.push(`cost: $${input.cost.toFixed(4)}`)
  if (segments.length > 0) lines.push(segments.join(" | "))
  if (input.changedFiles && input.changedFiles.length > 0) {
    const total = input.changedFiles.length
    const shown = input.changedFiles.slice(0, 8)
    const extra = total - shown.length
    lines.push(
      `changed: ${total} ${total === 1 ? "file" : "files"} (${shown.join(", ")}${extra > 0 ? `, +${extra} more` : ""})`,
    )
  }
  if (input.reason) {
    // Tail of the text, one line max so detail lines stay parseable.
    const tail = input.reason.replace(/\s+/g, " ").trim().slice(-400)
    if (tail) lines.push(`reason: ${tail}`)
  }
  return lines.join("\n")
}
