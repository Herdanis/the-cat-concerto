export type Outcome = "succeeded" | "failed" | "interrupted"

export const WORKER_AGENT = "concerto-worker"

export interface WorkerTag {
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

export function nudgeText(name: string, sid: string, outcome: Outcome): string {
  return `[concerto:event ${name} ${sid}] ${outcome} — collect and review now`
}
