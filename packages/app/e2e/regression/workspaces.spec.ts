import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import { installSseTransport } from "../utils/sse-transport"

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const root = "C:/OpenCode/WorkspaceProject"
const workspace = "C:/OpenCode/worktree/project/feature"
const createdWorkspace = "C:/OpenCode/worktree/project/quick-contrast-fix"
const project = {
  id: "proj_workspaces",
  worktree: root,
  vcs: "git" as const,
  name: "workspace-project",
  time: { created: 1, updated: 1 },
  sandboxes: [workspace],
}
const provider = {
  all: [
    {
      id: "opencode",
      name: "OpenCode",
      models: { test: { id: "test", name: "Test model", limit: { context: 200_000 } } },
    },
  ],
  connected: ["opencode"],
  default: { providerID: "opencode", modelID: "test" },
}
const diff = {
  file: "src/workspace.ts",
  additions: 3,
  deletions: 1,
  patch: "@@ -1 +1 @@\n-export const workspace = false\n+export const workspace = true",
}

function userMessage(sessionID: string, id: string, text: string, withDiff = false) {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "opencode", modelID: "test" },
      ...(withDiff ? { summary: { diffs: [diff] } } : {}),
    },
    parts: [{ id: `prt_${id}`, sessionID, messageID: id, type: "text", text }],
  }
}

async function init(page: Page, tab: Record<string, unknown>) {
  await page.addInitScript(
    ({ root, server, tab }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: root, expanded: true }] }, lastProject: { local: root } }),
      )
      localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify([{ server, ...tab }]))
    },
    { root, server, tab },
  )
}

test("selects local, new, and existing workspaces from the ready-ish start menu", async ({ page }) => {
  const draftID = "draft_workspaces"
  await mockOpenCodeServer(page, {
    directory: root,
    project,
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await init(page, { type: "draft", draftID, directory: root })

  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]'))

  const trigger = page.getByRole("button", { name: /^local$/i })
  await expect(trigger).toBeVisible()
  await trigger.hover()
  await expect(page.getByRole("tooltip")).toContainText("Select where to run session")
  await trigger.click()
  await expect(page.getByRole("menuitem", { name: /Local repository/ })).toBeVisible()
  const newWorkspace = page.getByRole("menuitem", { name: /New workspace/ })
  await expect(newWorkspace).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /Workspace/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "View all" })).toBeVisible()

  await newWorkspace.click()
  await expect(page.getByRole("button", { name: /New workspace/ })).toBeVisible()
  await expect(page.getByText("from main", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: /New workspace/ }).click()
  await page.getByRole("menuitem", { name: /Workspace/ }).hover()
  await page.getByRole("menuitem", { name: "feature" }).click()
  await expect(page.getByRole("button", { name: /feature/ })).toBeVisible()
})

test("searches long workspace lists within the available viewport", async ({ page }) => {
  const draftID = "draft_workspace_search"
  const workspaces = Array.from({ length: 10 }, (_, index) => `${workspace}-${index}`)
  await mockOpenCodeServer(page, {
    directory: root,
    project: { ...project, sandboxes: workspaces },
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await init(page, { type: "draft", draftID, directory: root })
  await page.setViewportSize({ width: 600, height: 360 })

  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]'))
  await page.getByRole("button", { name: /^local$/i }).click()
  await page.getByRole("menuitem", { name: /Workspace/ }).focus()
  await page.keyboard.press("ArrowRight")

  const submenu = page
    .locator('[data-component="menu-v2-content"]')
    .filter({ has: page.getByPlaceholder("Search workspaces") })
  const search = submenu.getByPlaceholder("Search workspaces")
  await expect(search).toBeFocused()
  const box = await submenu.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(360)

  await search.fill("feature-9")
  await expect(submenu.getByRole("menuitem", { name: "feature-9" })).toBeVisible()
  await expect(submenu.getByRole("menuitem", { name: "feature-0" })).toHaveCount(0)
})

test("lists and manually deletes workspaces from settings", async ({ page }) => {
  const draftID = "draft_workspace_settings"
  const cleanWorkspace = `${workspace}-clean`
  const inventory = { ...project, sandboxes: [workspace, cleanWorkspace] }
  const session = {
    id: "ses_workspace_settings",
    slug: "workspace-settings",
    projectID: project.id,
    directory: workspace,
    title: "Workspace settings session",
    version: "dev",
    time: { created: 1, updated: 2 },
  }
  let removal: { directory: string | null; body: unknown } | undefined
  let statusRequests = 0
  let sessionListRequests = 0
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (path === "/vcs/status" || path === "/api/vcs/status") statusRequests++
    if (path === "/session" || path === "/api/session") sessionListRequests++
  })

  await mockOpenCodeServer(page, {
    directory: root,
    project: inventory,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/experimental/worktree**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "DELETE" },
      })
      return
    }
    if (route.request().method() !== "DELETE") return route.fallback()
    const url = new URL(route.request().url())
    removal = { directory: url.searchParams.get("directory"), body: route.request().postDataJSON() }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "true",
    })
  })
  await init(page, { type: "draft", draftID, directory: root })

  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]'))
  await page.getByRole("button", { name: /^local$/i }).click()
  await page.getByRole("menuitem", { name: "View all" }).click()

  const settings = page.locator(".settings-v2-dialog")
  await expect(settings.getByRole("tab", { name: "Workspaces" })).toHaveAttribute("data-selected")
  await expect(settings.getByText(workspace, { exact: true })).toBeVisible()
  await expect(settings.getByText(cleanWorkspace, { exact: true })).toBeVisible()
  await expect(settings.getByText("Workspace settings session", { exact: true })).toBeVisible()
  await expect(settings.getByText("Automatically delete old workspaces")).toHaveCount(0)
  const firstSessionInventory = sessionListRequests
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await page.getByRole("button", { name: /^local$/i }).click()
  await page.getByRole("menuitem", { name: "View all" }).click()
  await expect(settings.getByText("Workspace settings session", { exact: true })).toBeVisible()
  expect(sessionListRequests).toBeGreaterThan(firstSessionInventory)
  await page.setViewportSize({ width: 375, height: 700 })
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })

  await settings.getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Delete all workspaces" }).click()
  const bulkConfirmation = page.locator('[data-dialog-layer="1"]')
  await expect(bulkConfirmation.getByText("Delete all 2 workspaces?")).toBeVisible()
  await expect(bulkConfirmation).toContainText("All projects")
  await bulkConfirmation.getByRole("button", { name: "Cancel" }).click()

  await settings.getByRole("button", { name: 'Delete workspace "feature"?' }).click()
  let confirmation = page.locator('[data-component="dialog-v2"]').filter({ hasText: 'Delete workspace "feature"?' })
  await expect(confirmation).toContainText("linked sessions")
  await expect(confirmation.getByRole("button", { name: "Delete workspace" })).toBeDisabled()
  const firstInspection = statusRequests
  await confirmation.getByRole("button", { name: "Cancel" }).click()

  await settings.getByRole("button", { name: 'Delete workspace "feature"?' }).click()
  confirmation = page.locator('[data-component="dialog-v2"]').filter({ hasText: 'Delete workspace "feature"?' })
  await expect(confirmation).toContainText("linked sessions")
  expect(statusRequests).toBeGreaterThan(firstInspection)
  await confirmation.getByRole("button", { name: "Cancel" }).click()

  await settings.getByRole("button", { name: 'Delete workspace "feature-clean"?' }).click()
  confirmation = page.locator('[data-component="dialog-v2"]').filter({ hasText: 'Delete workspace "feature-clean"?' })
  await expect(confirmation).toContainText("permanently removed")
  const beforeRemoval = statusRequests
  await confirmation.getByRole("button", { name: "Delete workspace" }).click()
  await expect.poll(() => removal).toEqual({ directory: root, body: { directory: cleanWorkspace } })
  expect(statusRequests).toBeGreaterThan(beforeRemoval)
  await expect(settings.getByText(cleanWorkspace, { exact: true })).toHaveCount(0)
  await expect(settings.getByText(workspace, { exact: true })).toBeVisible()
})

test("blocks deletion of the currently active workspace", async ({ page }) => {
  const draftID = "draft_workspace_active"
  let removed = false
  await mockOpenCodeServer(page, {
    directory: workspace,
    project,
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/experimental/worktree**", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback()
    removed = true
    await route.fulfill({ status: 200, contentType: "application/json", body: "true" })
  })
  await init(page, { type: "draft", draftID, directory: workspace })

  await page.goto(`/new-session?draftId=${draftID}`)
  await page.getByRole("button", { name: /feature/ }).click()
  await page.getByRole("menuitem", { name: "View all" }).click()
  const settings = page.locator(".settings-v2-dialog")
  await settings.getByRole("button", { name: 'Delete workspace "feature"?' }).click()
  const confirmation = page.locator('[data-component="dialog-v2"]').filter({ hasText: 'Delete workspace "feature"?' })
  await expect(confirmation).toContainText("active workspace")
  await expect(confirmation.getByRole("button", { name: "Delete workspace" })).toBeDisabled()
  expect(removed).toBe(false)
})

test("wraps the workspace toolbar for long project filters on mobile", async ({ page }) => {
  const draftID = "draft_workspace_mobile_filter"
  const other = {
    ...project,
    id: "proj_workspaces_other",
    name: "A second project with a deliberately long workspace filter label",
    worktree: "C:/OpenCode/AnotherWorkspaceProject",
    sandboxes: ["C:/OpenCode/worktree/another/feature-with-a-long-name"],
  }
  await mockOpenCodeServer(page, {
    directory: root,
    project,
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/project**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/project") return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify([project, other]),
    })
  })
  await init(page, { type: "draft", draftID, directory: root })
  await page.setViewportSize({ width: 375, height: 700 })

  await page.goto(`/new-session?draftId=${draftID}`)
  const dismissTabs = page.getByRole("button", { name: "Dismiss Tabs information" })
  if (await dismissTabs.isVisible()) await dismissTabs.click()
  await page.getByRole("button", { name: /^local$/i }).click()
  await page.getByRole("menuitem", { name: "View all" }).click()
  const settings = page.locator(".settings-v2-dialog")
  await expect(settings.getByRole("button", { name: "All projects" })).toBeVisible()
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

test("bulk deletion snapshots inventory and skips dirty or unknown workspaces", async ({ page }) => {
  const draftID = "draft_workspace_delete_all"
  const unknown = `${workspace}-unknown`
  const clean = `${workspace}-clean`
  const later = `${workspace}-later`
  const inventory = { ...project, sandboxes: [workspace, unknown, clean] }
  const removals: string[] = []
  let release = () => {}
  const deleteGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const transport = await installSseTransport<{ directory: string; payload: Record<string, unknown> }>(page, { server })
  await mockOpenCodeServer(page, {
    directory: root,
    project: inventory,
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/vcs/status**", async (route) => {
    const directory = new URL(route.request().url()).searchParams.get("directory")
    if (directory === workspace) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([{ path: "dirty.ts", status: "modified" }]),
      })
      return
    }
    if (directory === unknown) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ message: "status failed" }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "[]",
    })
  })
  await page.route("**/experimental/worktree**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "DELETE" },
      })
      return
    }
    if (route.request().method() !== "DELETE") return route.fallback()
    const body = route.request().postDataJSON() as { directory: string }
    removals.push(body.directory)
    await deleteGate
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "true",
    })
  })
  await init(page, { type: "draft", draftID, directory: root })

  await page.goto(`/new-session?draftId=${draftID}`)
  await transport.waitForConnection()
  await page.getByRole("button", { name: /^local$/i }).click()
  await page.getByRole("menuitem", { name: "View all" }).click()
  const settings = page.locator(".settings-v2-dialog")
  await settings.getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Delete all workspaces" }).click()
  const confirmation = page.locator('[data-dialog-layer="1"]')
  await expect(confirmation).toContainText("Delete all 3 workspaces?")
  await transport.send({
    directory: "global",
    payload: {
      id: "evt_workspace_added_after_confirmation",
      type: "project.updated",
      properties: { ...inventory, sandboxes: [...inventory.sandboxes, later] },
    },
  })
  await confirmation.getByRole("button", { name: "Delete all workspaces" }).click()

  await expect.poll(() => removals).toEqual([clean])
  const deleteButtons = settings.getByRole("button", { name: /Delete workspace/ })
  await expect.poll(() => deleteButtons.count()).toBeGreaterThan(0)
  expect(await deleteButtons.evaluateAll((buttons) => buttons.every((button) => button.hasAttribute("disabled")))).toBe(
    true,
  )
  release()
  await expect(settings.getByText(workspace, { exact: true })).toBeVisible()
  await expect(settings.getByText(unknown, { exact: true })).toBeVisible()
  await expect(settings.getByText(clean, { exact: true })).toHaveCount(0)
  await expect(settings.getByText(later, { exact: true })).toBeVisible()
})

test("applies the recovered new-workspace default without automatic cleanup", async ({ page }) => {
  const draftID = "draft_workspace_default"
  await mockOpenCodeServer(page, {
    directory: root,
    project,
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ draftID, root, server }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({
          general: { newLayoutDesigns: true },
          workspaces: { defaultDestination: "new", lastUsed: {} },
        }),
      )
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: root, expanded: true }] }, lastProject: { local: root } }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory: root }]),
      )
    },
    { draftID, root, server },
  )

  await page.goto(`/new-session?draftId=${draftID}`)
  await expect(page.getByRole("button", { name: /New workspace/ })).toBeVisible()
  await expect(page.getByText("from main", { exact: true })).toBeVisible()
})

test("submits the owning prompt after a new workspace becomes ready", async ({ page }) => {
  const draftID = "draft_workspace_submit"
  const sessionID = "ses_workspace_submit"
  const session = {
    id: sessionID,
    slug: "workspace-submit",
    projectID: project.id,
    directory: createdWorkspace,
    title: "New session",
    version: "dev",
    time: { created: 1, updated: 2 },
  }
  let prompt: unknown
  const transport = await installSseTransport<{ directory: string; payload: Record<string, unknown> }>(page, { server })
  await mockOpenCodeServer(page, {
    directory: root,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/experimental/worktree**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST" },
      })
      return
    }
    if (route.request().method() !== "POST") return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ name: "quick-contrast-fix", directory: createdWorkspace, branch: "quick-contrast-fix" }),
    })
  })
  await page.route("**/session**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== "/session") return route.fallback()
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST" },
      })
      return
    }
    if (route.request().method() !== "POST") return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(session),
    })
  })
  await page.route(`**/session/${sessionID}/prompt_async**`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST" },
      })
      return
    }
    prompt = route.request().postDataJSON()
    await route.fulfill({
      status: 204,
      headers: { "access-control-allow-origin": "*" },
    })
  })
  await init(page, { type: "draft", draftID, directory: root })

  await page.goto(`/new-session?draftId=${draftID}`)
  await transport.waitForConnection()
  await page.getByRole("button", { name: /^local$/i }).click()
  await page.getByRole("menuitem", { name: "New workspace" }).click()
  const editor = page.locator('[data-component="prompt-input"][contenteditable="true"]')
  await editor.fill("Build workspace support")
  await page.locator('[data-action="prompt-submit"]').click()

  const lifecycle = page.locator('[data-timeline-row="WorkspaceLifecycle"]')
  await expect(lifecycle).toContainText("Creating workspace")
  for (const attempt of [1, 2, 3, 4, 5]) {
    await transport.send({
      directory: createdWorkspace,
      payload: {
        id: `evt_submit_ready_${attempt}`,
        type: "worktree.ready",
        properties: { name: "quick-contrast-fix" },
      },
    })
    await page.waitForTimeout(100)
    if (prompt) break
  }
  await expect.poll(() => prompt).not.toBeUndefined()
  await expect(lifecycle).toContainText("Workspace created")
})

test("shows neutral workspace identity and the ready-ish session summary panel", async ({ page }) => {
  const sessionID = "ses_workspace_summary"
  const messageID = "msg_workspace_summary"
  const session = {
    id: sessionID,
    slug: "workspace-summary",
    projectID: project.id,
    directory: workspace,
    title: "Workspace summary session",
    version: "dev",
    time: { created: 1, updated: 2 },
  }
  const vcsRequests: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/vcs/diff") vcsRequests.push(request.url())
  })
  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory: workspace,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [userMessage(sessionID, messageID, "Implement workspace support", true)] }),
    vcsDiff: [diff],
  })
  await init(page, { type: "session", sessionId: sessionID })

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  const timeline = page.locator("[data-workspace-session]")
  await expect(timeline).toBeVisible()
  await expect(timeline.locator(`[aria-label="${workspace}"]`)).toHaveAttribute("tabindex", "0")
  await expect(timeline.locator('[data-slot="session-title-child"]')).toHaveClass(/text-v2-text-text-base/)
  await expect(timeline.locator('[data-slot="user-message-text"]')).not.toHaveCSS(
    "background-color",
    "rgb(59, 92, 246)",
  )

  const title = page.locator("[data-session-title]")
  await title.getByRole("button", { name: "Session details" }).click()
  const panel = page.locator('[data-component="session-summary-panel"]')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("workspace-project")
  await expect(panel).toContainText("feature")
  await expect(panel).toContainText("1 Changed file")
  await expect.poll(() => vcsRequests.length).toBeGreaterThan(0)
  const request = new URL(vcsRequests.at(-1)!)
  expect(request.searchParams.get("mode")).toBe("working")
  expect(request.searchParams.get("location[directory]")).toBe(workspace)
})

test("moves a changed local session to an existing workspace with an end-of-turn divider", async ({ page }) => {
  const sessionID = "ses_workspace_move_existing"
  const messageID = "msg_workspace_move_existing"
  const session = {
    id: sessionID,
    slug: "workspace-move-existing",
    projectID: project.id,
    directory: root,
    title: "Move this session",
    version: "dev",
    time: { created: 1, updated: 2 },
  }
  let move: unknown
  let releaseMove = () => {}
  const moveGate = new Promise<void>((resolve) => {
    releaseMove = resolve
  })
  const transport = await installSseTransport<{ directory: string; payload: Record<string, unknown> }>(page, { server })
  await mockOpenCodeServer(page, {
    directory: root,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [userMessage(sessionID, messageID, "Move this work", true)] }),
    vcsDiff: [diff],
  })
  await page.route("**/experimental/control-plane/move-session", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST" },
      })
      return
    }
    move = route.request().postDataJSON()
    await moveGate
    session.directory = workspace
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "null",
    })
  })
  await init(page, { type: "session", sessionId: sessionID })

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await transport.waitForConnection()
  const inlineMove = page
    .locator('[data-component="session-turn-diffs-group"]')
    .getByRole("button", { name: "Move to workspace" })
  await expect(inlineMove).toBeVisible()
  await inlineMove.click()
  await page.getByRole("menuitem", { name: "Workspace", exact: true }).hover()
  await page.getByRole("menuitem", { name: "feature" }).click()

  await expect
    .poll(() => move)
    .toEqual({
      sessionID,
      destination: { directory: workspace },
      moveChanges: true,
    })
  await page.locator("[data-session-title]").getByRole("button", { name: "More options" }).click()
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeDisabled()
  await expect(page.getByRole("menuitem", { name: /Delete/ })).toBeDisabled()
  await page.keyboard.press("Escape")
  releaseMove()
  const lifecycle = page.locator('[data-timeline-row="WorkspaceLifecycle"]')
  await expect(lifecycle).toContainText("Workspace set")
})

test("moves a changed local session through workspace creation without changing lifecycle semantics", async ({
  page,
}) => {
  const sessionID = "ses_workspace_move_new"
  const messageID = "msg_workspace_move_new"
  const session = {
    id: sessionID,
    slug: "workspace-move-new",
    projectID: project.id,
    directory: root,
    title: "Create a workspace",
    version: "dev",
    time: { created: 1, updated: 2 },
  }
  let move: unknown
  const transport = await installSseTransport<{ directory: string; payload: Record<string, unknown> }>(page, { server })
  await mockOpenCodeServer(page, {
    directory: root,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [userMessage(sessionID, messageID, "Create isolated workspace", true)] }),
    vcsDiff: [diff],
  })
  await page.route("**/experimental/worktree**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST" },
      })
      return
    }
    if (route.request().method() !== "POST") return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ name: "quick-contrast-fix", directory: createdWorkspace, branch: "quick-contrast-fix" }),
    })
  })
  await page.route("**/experimental/control-plane/move-session", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST" },
      })
      return
    }
    move = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "null",
    })
  })
  await init(page, { type: "session", sessionId: sessionID })

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await transport.waitForConnection()
  await page.locator("[data-session-title]").getByRole("button", { name: "Session details" }).click()
  const panel = page.locator('[data-component="session-summary-panel"]')
  await panel.getByRole("button", { name: "Local repository" }).click()
  await expect(page.getByRole("menuitem", { name: "New workspace" })).toBeVisible()
  await page.getByRole("menuitem", { name: "New workspace" }).click()

  const lifecycle = page.locator('[data-timeline-row="WorkspaceLifecycle"]')
  await expect(lifecycle).toContainText("Creating workspace")
  for (const attempt of [1, 2, 3, 4, 5]) {
    await transport.send({
      directory: createdWorkspace,
      payload: {
        id: `evt_worktree_ready_${attempt}`,
        type: "worktree.ready",
        properties: { name: "quick-contrast-fix" },
      },
    })
    await page.waitForTimeout(100)
    if (move) break
  }
  await expect
    .poll(() => move)
    .toEqual({
      sessionID,
      destination: { directory: createdWorkspace },
      moveChanges: true,
    })
  await transport.send({
    directory: createdWorkspace,
    payload: {
      id: "evt_workspace_created",
      type: "session.next.moved",
      properties: {
        timestamp: Date.now(),
        sessionID,
        location: { directory: createdWorkspace },
        subdirectory: "",
      },
    },
  })
  await expect(lifecycle).toContainText("Workspace created")
})
