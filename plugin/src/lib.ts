export type Outcome = "succeeded" | "failed" | "interrupted"

export const WORKER_AGENT = "concerto-worker"

export type WorkerTag = {
  concerto: {
    role: "worker"
    name: string
    directory: string
  }
}

export function workerTag(name: string, directory: string): WorkerTag {
  return { concerto: { role: "worker", name, directory } }
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

export function workerPrefix(name: string, directory: string, sid: string): string {
  return `[concerto:worker ${name}${dirSuffix(name, directory)} ${sid}]`
}

const dirSuffix = (name: string, directory: string): string => {
  const base = directory.split("/").filter(Boolean).pop()
  return base && base !== name ? ` (${base})` : ""
}

export function orchestratorPrefix(): string {
  return "[concerto:orchestrator]"
}

export interface SessionTime {
  busy?: number
  idle?: number
}

// idle is only stamped when a turn finishes; absent means never idle.
export function isBusy(time?: SessionTime): boolean {
  return (time?.busy ?? 0) > (time?.idle ?? 0)
}

// True when the final turn delivered a completed report — the report
// prompt already woke the orchestrator, so the nudge is redundant.
// context() may return newest-first, so order by created time first.
export function lastTurnReported(
  messages: Array<{ type?: string; content?: unknown; time?: { created?: unknown } }>,
): boolean {
  const ordered = [...messages].sort((a, b) => created(a) - created(b))
  for (let i = ordered.length - 1; i >= 0; i--) {
    const message = ordered[i]
    if (message?.type === "user") break
    if (message?.type !== "assistant") continue
    const parts = Array.isArray(message.content) ? message.content : []
    const reported = parts.some((part) => {
      const candidate = part as { type?: unknown; name?: unknown; state?: { status?: unknown } }
      return (
        candidate?.type === "tool" &&
        candidate.name === "concerto_report" &&
        candidate.state?.status === "completed"
      )
    })
    if (reported) return true
  }
  return false
}

// Missing/invalid timestamps sort as 0 and keep input order (stable sort).
const created = (message: { time?: { created?: unknown } }): number =>
  typeof message?.time?.created === "number" && Number.isFinite(message.time.created) ? message.time.created : 0

export interface NudgeInput {
  name: string
  sid: string
  directory: string
  outcome: Outcome
}

// Completion signal only: the worker's report carries the substance.
export function buildNudge(input: NudgeInput): string {
  return `[concerto:event ${input.name}${dirSuffix(input.name, input.directory)} ${input.sid}] ${input.outcome} — collect and review now`
}
