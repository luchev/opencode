import type { Project } from "@opencode-ai/sdk/v2/client"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { getFilename } from "@opencode-ai/core/util/path"
import { createStore } from "solid-js/store"
import { For, Show, type ComponentProps, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { pathKey } from "@/utils/path-key"
import { Worktree } from "@/utils/worktree"
import { WorkspaceOperation } from "@/utils/workspace-operation"
import { showToast } from "@/utils/toast"
import type { ServerScope } from "@/utils/server-scope"
import { workspaceDirectories } from "@/utils/workspace"
import {
  WORKSPACE_PLACEMENT_REFRESH_TIMEOUT_MS,
  WORKSPACE_PREPARATION_TIMEOUT_MS,
  workspaceRequestWithTimeout,
} from "@/utils/workspace-request"

export function SessionWorkspaceMenu(props: {
  eligible?: boolean
  sessionID: string
  project: Project
  directory: string
  messageID?: string
  placement?: ComponentProps<typeof MenuV2>["placement"]
  gutter?: number
  class?: string
  children: JSX.Element
  onOpenChange?: (open: boolean) => void
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [store, setStore] = createStore({ selected: undefined as string | undefined })
  const operationPending = () => WorkspaceOperation.get(serverSDK().scope, props.sessionID)?.status === "pending"
  const blocked = () =>
    props.eligible === false || operationPending() || serverSync().session.data.session_working(props.sessionID)
  const workspaces = () =>
    workspaceDirectories(props.project).filter((workspace) => pathKey(workspace) !== pathKey(props.directory))

  const fail = (scope: ServerScope, sessionID: string, message: string) => {
    setStore("selected", undefined)
    if (WorkspaceOperation.get(scope, sessionID)?.status === "complete") return
    WorkspaceOperation.fail(scope, sessionID, message)
    showToast({ variant: "error", title: language.t("workspace.move.failed"), description: message })
  }
  const move = async (selection: "create" | string) => {
    if (store.selected || blocked()) return
    const sdk = serverSDK()
    const sync = serverSync()
    const scope = sdk.scope
    const sessionID = props.sessionID
    const messageID = props.messageID
    const root = props.project.worktree
    const source = props.directory
    setStore("selected", selection)

    const destination =
      selection === "create"
        ? await createWorkspace(root, sessionID, messageID, sdk, (message) => fail(scope, sessionID, message), {
            createFailed: language.t("prompt.toast.worktreeCreateFailed.title"),
            stillPreparing: language.t("workspace.error.stillPreparing"),
          })
        : selection
    if (!destination) return

    WorkspaceOperation.start(scope, sessionID, selection === "create" ? "create" : "move", destination, messageID)
    if (sync.session.data.session_working(sessionID)) {
      fail(scope, sessionID, language.t("workspace.move.failed"))
      return
    }
    await workspaceRequestWithTimeout(
      (signal) =>
        sdk.client.experimental.controlPlane.moveSession(
          {
            sessionID,
            destination: { directory: destination },
            moveChanges: true,
          },
          { signal },
        ),
      language.t("workspace.move.failed"),
      WORKSPACE_PREPARATION_TIMEOUT_MS,
    )
      .then(async () => {
        for (const attempt of Array.from({ length: 20 }, (_, index) => index)) {
          const session = await workspaceRequestWithTimeout(
            (signal) => sync.session.resolve(sessionID, { force: true, signal }),
            language.t("workspace.move.failed"),
            WORKSPACE_PLACEMENT_REFRESH_TIMEOUT_MS,
          ).catch(() => undefined)
          if (session && pathKey(session.directory) === pathKey(destination)) {
            WorkspaceOperation.complete(scope, sessionID, destination)
            sync.reindexSession(sessionID, source)
            return
          }
          if (WorkspaceOperation.get(scope, sessionID)?.status === "complete") return
          await new Promise((resolve) => setTimeout(resolve, Math.min(250 + attempt * 50, 1_000)))
        }
        fail(scope, sessionID, language.t("workspace.move.failed"))
      })
      .catch((error) =>
        fail(scope, sessionID, error instanceof Error ? error.message : language.t("common.requestFailed")),
      )
  }

  return (
    <MenuV2
      placement={props.placement ?? "bottom-end"}
      gutter={props.gutter ?? 4}
      modal={false}
      onOpenChange={props.onOpenChange}
    >
      <MenuV2.Trigger class={props.class} disabled={blocked()}>
        {props.children}
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="w-[200px]">
          <MenuV2.Group>
            <MenuV2.GroupLabel>{language.t("workspace.move.title")}</MenuV2.GroupLabel>
            <MenuV2.Item disabled={!!store.selected || blocked()} onSelect={() => void move("create")}>
              <Icon name="workspace-new" />
              {language.t("workspace.new")}
            </MenuV2.Item>
          </MenuV2.Group>
          <Show when={workspaces().length > 0}>
            <MenuV2.Separator class="h-[0.5px]" />
            <MenuV2.Sub gutter={0} overlap overflowPadding={8}>
              <MenuV2.SubTrigger>
                <Icon name="workspace" />
                {language.t("session.new.workspace.existing").replace(/…$/, "")}
              </MenuV2.SubTrigger>
              <MenuV2.Portal>
                <MenuV2.SubContent class="w-[200px]">
                  <For each={workspaces()}>
                    {(workspace) => (
                      <MenuV2.Item disabled={!!store.selected || blocked()} onSelect={() => void move(workspace)}>
                        <Icon name="workspace-isolated" />
                        <span class="min-w-0 flex-1 truncate">{getFilename(workspace)}</span>
                      </MenuV2.Item>
                    )}
                  </For>
                </MenuV2.SubContent>
              </MenuV2.Portal>
            </MenuV2.Sub>
          </Show>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

async function createWorkspace(
  root: string,
  sessionID: string,
  messageID: string | undefined,
  serverSDK: ReturnType<ReturnType<typeof useServerSDK>>,
  fail: (message: string) => void,
  messages: { createFailed: string; stillPreparing: string },
) {
  WorkspaceOperation.start(serverSDK.scope, sessionID, "create", root, messageID)
  const created = await workspaceRequestWithTimeout(
    (signal) => serverSDK.client.worktree.create({ directory: root }, { signal }),
    messages.createFailed,
    WORKSPACE_PREPARATION_TIMEOUT_MS,
  )
    .then((result) => result.data)
    .catch((error) => {
      fail(error instanceof Error ? error.message : messages.createFailed)
      return undefined
    })
  if (!created?.directory) return
  WorkspaceOperation.start(serverSDK.scope, sessionID, "create", created.directory, messageID)
  Worktree.pending(serverSDK.scope, created.directory)
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined }
  const timeout = new Promise<ReturnType<typeof Worktree.get>>((resolve) => {
    timer.id = setTimeout(
      () => resolve({ status: "failed", message: messages.stillPreparing }),
      WORKSPACE_PREPARATION_TIMEOUT_MS,
    )
  })
  const ready = await Promise.race([Worktree.wait(serverSDK.scope, created.directory), timeout]).finally(() => {
    if (timer.id) clearTimeout(timer.id)
  })
  if (!ready || ready.status === "failed") {
    fail(ready?.message ?? messages.createFailed)
    return
  }
  return created.directory
}
