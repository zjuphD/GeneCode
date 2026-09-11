import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentArtifact, getAgentRun, listAgentRuns, resetAgentApiTokenCache } from "./service";

describe("durable Agent journal client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAgentApiTokenCache();
  });

  it("lists durable runs with a bounded limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      runs: [{ run_id: "run-1", mode: "execute", workspace: "cloning", status: "completed" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const runs = await listAgentRuns(999);
    expect(runs[0]?.run_id).toBe("run-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=200");
  });

  it("restores one durable run projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      run: { run_id: "run-2", mode: "execute", workspace: "rtqpcr", status: "interrupted", events: [] },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const run = await getAgentRun("run 2");
    expect(run.status).toBe("interrupted");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("run%202");
  });

  it("requests a small artifact preview by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      artifact: {
        artifact_id: "artifact-1",
        content_hash: "sha256:test",
        byte_size: 90000,
        dataPreview: "{\"candidates\":...",
        dataTruncated: true,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const artifact = await getAgentArtifact("run-3", "artifact/1");
    expect(artifact.dataTruncated).toBe(true);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("run-3/artifacts/artifact%2F1");
    expect(url).toContain("preview=1");
    expect(url).toContain("maxBytes=32768");
  });
});
