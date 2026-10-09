#!/usr/bin/env node
import { run } from "./commands.js";

// Output piped into `head` and the like: stop quietly when the reader goes away.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(process.exitCode ?? 0);
  throw e;
});

const code = await run(process.argv.slice(2), {
  out: (line) => process.stdout.write(line + "\n"),
  err: (line) => process.stderr.write(line + "\n"),
  env: process.env,
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
});
process.exitCode = code;
