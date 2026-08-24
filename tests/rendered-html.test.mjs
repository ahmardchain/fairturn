import assert from "node:assert/strict";
import test from "node:test";

test("renders the FairTurn product shell", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>FairTurn — Community operations that remember<\/title>/i);
  assert.match(html, /Your Telegram communities/i);
  assert.match(html, /Group health/i);
  assert.match(html, /Groups FairTurn manages/i);
  assert.match(html, /Add a bot to a group/i);
  assert.match(html, /Automate your inbox/i);
  assert.doesNotMatch(html, /Good morning, Amara\./i);
  assert.doesNotMatch(html, /conversations triaged/i);
  assert.match(html, /aria-label="FairTurn mobile navigation"/i);
  assert.doesNotMatch(html, /class="sidebar"/i);
  assert.doesNotMatch(html, /class="topbar"/i);
});
