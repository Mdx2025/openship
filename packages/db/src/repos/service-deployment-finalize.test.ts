import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "../schema";
import { createServiceRepo } from "./service.repo";

let client: PGlite;
afterEach(async () => { await client?.close(); });

describe("service deployment finalization", () => {
  it("updates the planned row, preserves check linkage, and returns its real identity", async () => {
    client = new PGlite("memory://");
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
    // Isolated test database only: unrelated parent rows are not this contract.
    await client.exec("SET session_replication_role = replica");
    const repo = createServiceRepo(db);
    const planned = await repo.createServiceDeployment({
      deploymentId: "dep_test", serviceId: "svc_test", serviceName: "redis",
      status: "skipped", reasonSkipped: "planned", checkRunId: 123,
      checkRunUrl: "https://github.com/example/check/123", logsRef: "section:redis",
    });
    const result = await repo.createServiceDeployment({
      deploymentId: "dep_test", serviceId: "svc_test", status: "success",
      containerId: "container_current", imageRef: "redis:7-alpine", hostPort: 32768,
    });
    expect(result).toMatchObject({
      id: planned.id, checkRunId: 123, checkRunUrl: planned.checkRunUrl,
      logsRef: "section:redis", createdAt: planned.createdAt, serviceName: "redis",
      status: "success", containerId: "container_current", reasonSkipped: null,
    });
    expect(await repo.listByDeployment("dep_test")).toHaveLength(1);
    const failed = await repo.createServiceDeployment({
      deploymentId: "dep_test", serviceId: "svc_test", status: "failure", reason: "failed",
    });
    expect(failed).toMatchObject({ id: planned.id, status: "failure", containerId: null, hostPort: null });
    const fresh = await repo.createServiceDeployment({
      deploymentId: "dep_next", serviceId: "svc_test", status: "success",
    });
    expect(fresh.id).not.toBe(planned.id);
    expect(await repo.findServiceDeployment(fresh.id)).toEqual(fresh);
  });
});
