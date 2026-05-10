// Stack-validation smoke test for ADR 0001 (TypeScript on Node).
// Uses only the Node built-in `http` module — no dependencies, no package.json,
// no tsconfig. Run with `npx tsx scripts/hello-world.ts` (or `ts-node`) once
// either is available locally; this file will be removed when the real server
// lands as part of the repo-skeleton work.

import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("hello, world\n");
});

server.listen(port, () => {
  console.log(`hello-world smoke test listening on http://127.0.0.1:${port}`);
});
