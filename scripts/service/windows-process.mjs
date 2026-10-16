// Pure helpers for finding the Spent server process on Windows. Kept free of
// side effects so they can be tested on any platform.

/** PIDs listening on `port`, from `netstat -ano -p TCP` output. */
export function parseListeningPids(netstatOutput, port) {
  const pids = new Set();
  for (const line of netstatOutput.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    // Proto, Local Address, Foreign Address, State, PID
    if (cols.length < 5 || cols[3] !== "LISTENING") continue;
    if (!cols[1].endsWith(`:${port}`)) continue;
    const pid = Number(cols[4]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/**
 * True when a command line is `next start` from this checkout. Guards the
 * stop command so it never kills an unrelated process that took the port.
 */
export function isSpentServerCommand(commandLine, repoRoot) {
  if (!commandLine) return false;
  const norm = (s) => s.replaceAll("/", "\\").toLowerCase();
  const cmd = norm(commandLine);
  const nextBin = norm(`${repoRoot}\\node_modules\\next\\dist\\bin\\next`);
  return cmd.includes(nextBin) && /\sstart(\s|$)/.test(cmd);
}
