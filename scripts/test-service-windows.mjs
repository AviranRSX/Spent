import assert from "node:assert/strict";
import test from "node:test";
import {
  isSpentServerCommand,
  parseListeningPids,
} from "./service/windows-process.mjs";

const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1200
  TCP    127.0.0.1:41234        0.0.0.0:0              LISTENING       4396
  TCP    127.0.0.1:41234        127.0.0.1:55001        ESTABLISHED     4396
  TCP    127.0.0.1:55001        127.0.0.1:41234        ESTABLISHED     7000
  TCP    127.0.0.1:412340       0.0.0.0:0              LISTENING       8000
  TCP    [::1]:41234            [::]:0                 LISTENING       4396
`;

test("parseListeningPids returns each listener on the port once", () => {
  assert.deepEqual(parseListeningPids(NETSTAT, 41234), [4396]);
  assert.deepEqual(parseListeningPids(NETSTAT, 3000), []);
});

const REPO = "C:\\Users\\Example User\\Spent";

test("isSpentServerCommand matches next start from this checkout only", () => {
  const ours = `"C:\\Program Files\\nodejs\\node.exe"  "${REPO}\\node_modules\\next\\dist\\bin\\next" start -H 127.0.0.1 -p 41234`;
  assert.equal(isSpentServerCommand(ours, REPO), true);
  assert.equal(isSpentServerCommand(ours.toUpperCase(), REPO.replaceAll("\\", "/")), true);

  const dev = ours.replace(" start ", " dev ");
  assert.equal(isSpentServerCommand(dev, REPO), false);
  const otherCheckout = ours.replace(REPO, "C:\\Users\\Example User\\Other");
  assert.equal(isSpentServerCommand(otherCheckout, REPO), false);
  assert.equal(isSpentServerCommand("", REPO), false);
  assert.equal(isSpentServerCommand("C:\\Windows\\System32\\svchost.exe -k netsvcs", REPO), false);
});
