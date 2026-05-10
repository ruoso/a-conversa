// Stack-validation smoke test for ADR 0003 (Frontend framework: React).
// Renders a minimal React component to a string via react-dom/server and
// prints the HTML. No package.json, no tsconfig, no bundler — run with:
//   npx --yes --package=react --package=react-dom --package=tsx --package=@types/react \
//     -c 'NODE_PATH=$(dirname $(dirname $(which tsx))) tsx scripts/hello-react.tsx'
// (NODE_PATH points the resolver at the npx-cache node_modules so tsx can
// find react/react-dom; this dance goes away once the real frontend
// workspace has its own package.json.) This file will be removed when that
// workspace lands as part of the repo-skeleton work.

import * as React from "react";
import { renderToString } from "react-dom/server";

function Hello(): React.ReactElement {
  return React.createElement("p", null, "hello, react");
}

const html = renderToString(React.createElement(Hello));
console.log(html);

if (!html.includes("hello, react")) {
  console.error("smoke test failed: rendered HTML missing expected text");
  process.exit(1);
}
