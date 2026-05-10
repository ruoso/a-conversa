// Stack-validation smoke test for ADR 0003 (Frontend framework: React).
// Renders a minimal React component to a string via react-dom/server and
// prints the HTML. Run with `npm run smoke:react` after `npm install`.
// Throwaway — will be removed when the real frontend workspace lands as
// part of the repo-skeleton work.

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
