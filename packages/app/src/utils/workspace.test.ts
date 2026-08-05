import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  filterWorkspaceInventory,
  inspectWorkspaceDeletion,
  isProjectDirectory,
  isWorkspaceDirectory,
  isWorkspaceSelection,
  removeWorkspacesSequentially,
  mergeWorkspaceSessionInventory,
  runWorkspaceDeleteTransaction,
  sessionsForWorkspace,
  workspaceDefaultSelection,
  workspaceDirectories,
  workspaceInventory,
} from "./workspace"

describe("isWorkspaceDirectory", () => {
  const project = {
    worktree: "C:\\repo\\",
    sandboxes: ["C:\\repo-workspaces\\feature\\", "C:\\repo-workspaces\\other"],
  }

  test("distinguishes managed workspaces from the local repository", () => {
    expect(isWorkspaceDirectory(project, "C:\\repo")).toBe(false)
    expect(isWorkspaceDirectory(project, "C:\\repo-workspaces\\feature")).toBe(true)
    expect(isWorkspaceDirectory(project, "c:\\repo-workspaces\\feature\\packages\\app")).toBe(true)
  })

  test("does not classify unknown directories", () => {
    expect(isWorkspaceDirectory(project, "C:\\other")).toBe(false)
    expect(isWorkspaceDirectory(undefined, "C:\\repo-workspaces\\feature")).toBe(false)
  })
})

describe("isWorkspaceSelection", () => {
  const project = { worktree: "/repo", sandboxes: ["/workspaces/feature"] }

  test("accepts local, new, and managed workspace selections", () => {
    expect(isWorkspaceSelection(project, "main")).toBe(true)
    expect(isWorkspaceSelection(project, "create")).toBe(true)
    expect(isWorkspaceSelection(project, "/repo/")).toBe(true)
    expect(isWorkspaceSelection(project, "/workspaces/feature/")).toBe(true)
    expect(isWorkspaceSelection({ worktree: "C:\\repo" }, "c:\\repo\\")).toBe(true)
  })

  test("rejects selections from a different project", () => {
    expect(isWorkspaceSelection(project, "/other/workspace")).toBe(false)
  })
})

describe("workspaceDefaultSelection", () => {
  test("uses the explicit global default", () => {
    expect(workspaceDefaultSelection("local", "workspace")).toBe("main")
    expect(workspaceDefaultSelection("new", "local")).toBe("create")
  })

  test("falls back to the last mode used in each project", () => {
    expect(workspaceDefaultSelection("last-used", "workspace")).toBe("create")
    expect(workspaceDefaultSelection("last-used", "local")).toBe("main")
    expect(workspaceDefaultSelection("last-used", undefined)).toBe("main")
  })
})

describe("isProjectDirectory", () => {
  const project = { worktree: "/repo", sandboxes: ["/workspaces/feature"] }

  test("accepts local and workspace subdirectories only", () => {
    expect(isProjectDirectory(project, "/repo/packages/app")).toBe(true)
    expect(isProjectDirectory(project, "/workspaces/feature/packages/app")).toBe(true)
    expect(isProjectDirectory(project, "/other/project")).toBe(false)
  })
})

test("groups and filters workspace inventory by project", () => {
  const inventory = workspaceInventory([
    { id: "a", worktree: "/a", sandboxes: ["/a", "/a/one", "/a/two"] },
    { id: "b", worktree: "/b", sandboxes: ["/b/one"] },
  ])

  expect(inventory.map((item) => [item.project.id, item.directory])).toEqual([
    ["a", "/a/one"],
    ["a", "/a/two"],
    ["b", "/b/one"],
  ])
  expect(filterWorkspaceInventory(inventory, "a").map((item) => item.directory)).toEqual(["/a/one", "/a/two"])
  expect(filterWorkspaceInventory(inventory, "all")).toEqual(inventory)
})

test("excludes the project checkout from workspace directories", () => {
  expect(workspaceDirectories({ worktree: "C:\\repo", sandboxes: ["c:\\repo\\", "C:\\workspaces\\one"] })).toEqual([
    "C:\\workspaces\\one",
  ])
})

test("deletes all workspaces sequentially", async () => {
  const calls: string[] = []
  let release = () => {}
  const first = new Promise<void>((resolve) => {
    release = resolve
  })
  const removing = removeWorkspacesSequentially(["one", "two"], async (workspace) => {
    calls.push(`start:${workspace}`)
    if (workspace === "one") await first
    calls.push(`end:${workspace}`)
  })

  await Promise.resolve()
  expect(calls).toEqual(["start:one"])
  release()
  await removing
  expect(calls).toEqual(["start:one", "end:one", "start:two", "end:two"])
})

test("continues sequential deletion after a handled request failure", async () => {
  const calls: string[] = []
  await removeWorkspacesSequentially(["one", "two"], async (workspace) => {
    calls.push(workspace)
    if (workspace === "one") await Promise.reject(new Error("failed")).catch(() => {})
  })
  expect(calls).toEqual(["one", "two"])
})

test("blocks unsafe workspace deletion", () => {
  const session = (directory: string) => ({ directory }) as Session
  expect(
    inspectWorkspaceDeletion({
      workspace: "/workspace",
      activeDirectory: "/workspace/app",
      sessions: [],
      status: "clean",
    }),
  ).toBe("active")
  expect(
    inspectWorkspaceDeletion({
      workspace: "/workspace",
      sessions: [session("/workspace/packages/app")],
      status: "clean",
    }),
  ).toBe("linked")
  expect(
    inspectWorkspaceDeletion({
      workspace: "/workspace",
      activeDirectory: "/workspace/app",
      sessions: [],
      status: "dirty",
    }),
  ).toBe("active")
  expect(
    inspectWorkspaceDeletion({
      workspace: "/workspace",
      sessions: [session("/workspace/packages/app")],
      status: "dirty",
    }),
  ).toBe("linked")
  expect(inspectWorkspaceDeletion({ workspace: "/workspace", sessions: [], status: "dirty" })).toBe("dirty")
  expect(inspectWorkspaceDeletion({ workspace: "/workspace", sessions: [], status: "unknown" })).toBe("unknown")
  expect(inspectWorkspaceDeletion({ workspace: "/workspace", sessions: [], status: "clean" })).toBe("safe")
})

test("groups nested non-archived workspace sessions by latest activity", () => {
  const session = (id: string, directory: string, updated: number, archived?: number) =>
    ({ id, directory, time: { created: 1, updated, archived } }) as Session
  const sessions = sessionsForWorkspace(
    [
      session("old", "/workspace", 2),
      session("nested", "/workspace/packages/app", 3),
      session("archived", "/workspace", 4, 5),
      session("other", "/other", 6),
    ],
    "/workspace",
  )
  expect(sessions.map((item) => item.id)).toEqual(["nested", "old"])
})

test("merges workspace placement by freshness with authoritative server ties", () => {
  const session = (directory: string, updated: number) =>
    ({ id: "session", directory, time: { created: 1, updated } }) as Session

  expect(mergeWorkspaceSessionInventory([session("/destination", 3)], [session("/source", 2)])[0]?.directory).toBe(
    "/destination",
  )
  expect(mergeWorkspaceSessionInventory([session("/destination", 3)], [session("/source", 3)])[0]?.directory).toBe(
    "/destination",
  )
  expect(mergeWorkspaceSessionInventory([session("/destination", 2)], [session("/source", 3)])[0]?.directory).toBe(
    "/source",
  )
})

test.each(["single", "bulk"])("acquires one atomic %s workspace delete transaction", async () => {
  let transaction: "confirm" | number | undefined = "confirm"
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let requests = 0
  const run = (token: number) =>
    runWorkspaceDeleteTransaction({
      token,
      set: (update) => {
        transaction = update(transaction)
      },
      task: async () => {
        requests++
        await gate
      },
    })

  const first = run(1)
  const duplicate = run(2)
  expect(requests).toBe(1)
  expect(transaction as "confirm" | number | undefined).toBe(1)
  expect(await duplicate).toBe(false)
  release()
  expect(await first).toBe(true)
  expect(transaction).toBeUndefined()
  expect(requests).toBe(1)
})

test("workspace delete completion does not unlock a different owner", async () => {
  let transaction: "confirm" | number | undefined = "confirm"
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const removing = runWorkspaceDeleteTransaction({
    token: 1,
    set: (update) => {
      transaction = update(transaction)
    },
    task: () => gate,
  })

  transaction = 2
  release()
  expect(await removing).toBe(true)
  expect(transaction).toBe(2)
})
