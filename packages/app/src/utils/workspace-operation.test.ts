import { describe, expect, test } from "bun:test"
import { ServerScope } from "./server-scope"
import { canMoveSessionToWorkspace, WorkspaceOperation } from "./workspace-operation"

test("workspace moves require settled followup state", () => {
  expect(canMoveSessionToWorkspace({ queued: 0, failed: false, paused: false, editing: false })).toBe(true)
  expect(canMoveSessionToWorkspace({ queued: 1, failed: false, paused: false, editing: false })).toBe(false)
  expect(canMoveSessionToWorkspace({ queued: 0, failed: true, paused: false, editing: false })).toBe(false)
  expect(canMoveSessionToWorkspace({ queued: 0, failed: false, paused: true, editing: false })).toBe(false)
  expect(canMoveSessionToWorkspace({ queued: 0, failed: false, paused: false, editing: true })).toBe(false)
})

describe("WorkspaceOperation", () => {
  test("reacts to operation completion", () => {
    WorkspaceOperation.start(ServerScope.local, "session", "move", "/workspace")
    expect(WorkspaceOperation.get(ServerScope.local, "session")?.status).toBe("pending")
    WorkspaceOperation.complete(ServerScope.local, "session")
    expect(WorkspaceOperation.get(ServerScope.local, "session")?.status).toBe("complete")
  })

  test("ignores completion for a different destination", () => {
    WorkspaceOperation.start(ServerScope.local, "destination", "move", "/workspace/expected")
    WorkspaceOperation.complete(ServerScope.local, "destination", "/workspace/other")
    expect(WorkspaceOperation.get(ServerScope.local, "destination")?.status).toBe("pending")
  })

  test("does not downgrade a completed move after cleanup fails", () => {
    WorkspaceOperation.start(ServerScope.local, "cleanup", "move", "/workspace")
    WorkspaceOperation.complete(ServerScope.local, "cleanup")
    WorkspaceOperation.fail(ServerScope.local, "cleanup", "source cleanup failed")
    expect(WorkspaceOperation.get(ServerScope.local, "cleanup")?.status).toBe("complete")
  })

  test("settles a pending create from its worktree directory", () => {
    WorkspaceOperation.start(ServerScope.local, "create", "create", "/workspace/create")
    WorkspaceOperation.completeCreate(ServerScope.local, "/workspace/create")
    expect(WorkspaceOperation.get(ServerScope.local, "create")?.status).toBe("complete")
  })
})
