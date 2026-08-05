import { expect, test } from "bun:test"
import { workspaceRequestWithTimeout } from "./workspace-request"

test("workspace requests abort at the bounded timeout", async () => {
  let aborted = false
  const request = workspaceRequestWithTimeout(
    (signal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(signal.reason)
          },
          { once: true },
        )
      }),
    "Workspace request failed",
    1,
  )

  await expect(request).rejects.toThrow("Workspace request failed")
  expect(aborted).toBe(true)
})

test("workspace requests preserve non-timeout failures", async () => {
  await expect(
    workspaceRequestWithTimeout(() => Promise.reject(new Error("Server failed")), "Workspace request failed", 1_000),
  ).rejects.toThrow("Server failed")
})

test("workspace request timeout settles when the request ignores abort", async () => {
  await expect(
    workspaceRequestWithTimeout(() => new Promise<never>(() => {}), "Workspace request failed", 1),
  ).rejects.toThrow("Workspace request failed")
})
