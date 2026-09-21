import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildConfig } from "../types";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(), spawn,
}));
import { prepareSourceTree, createDockerBuildContext } from "./docker-build-context";

afterEach(() => { spawn.mockReset(); });

function fakeClone() {
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
}

const config = {
  repoUrl: "https://github.com/example/private.git", branch: "main",
  gitAmbient: { via: "gh" }, stack: "node", buildImage: "node:22", runtimeImage: "node:22",
  installCommand: "", buildCommand: "", startCommand: "node index.js", envVars: {}, port: 3000,
} as BuildConfig;

describe("orchestrator clone identity boundary", () => {
  it.each([undefined, false])("does not borrow server ambient credentials (sameHost=%s)", async (sameHost) => {
    fakeClone();
    const tree = await prepareSourceTree(config, { sameHost });
    try {
      expect(spawn.mock.calls[0]![1]).toEqual(expect.arrayContaining(["-c", "credential.helper="]));
    } finally { await tree.cleanup(); }
  });

  it("uses gh identity only for an explicitly same-host clone", async () => {
    fakeClone();
    const tree = await prepareSourceTree(config, { sameHost: true });
    try {
      expect(spawn.mock.calls[0]![1]).not.toContain("credential.helper=");
      expect(spawn.mock.calls[0]![2].env.GIT_CONFIG_VALUE_0).toContain("gh auth git-credential");
    } finally { await tree.cleanup(); }
  });

  it.each([false, true])("forwards host-local relay only on the single-image same-host path (%s)", async (sameHost) => {
    fakeClone();
    const tree = await createDockerBuildContext({ ...config, gitAmbient: undefined, gitCredentialHelperPath: "/tmp/test-relay" }, { sameHost });
    try {
      if (sameHost) {
        expect(spawn.mock.calls[0]![2].env.GIT_CONFIG_VALUE_0).toBe("/tmp/test-relay");
      } else {
        expect(spawn.mock.calls[0]![1]).toContain("credential.helper=");
        expect(spawn.mock.calls[0]![2].env.GIT_ASKPASS).toBe("/bin/echo");
      }
    } finally { await tree.cleanup(); }
  });
});
