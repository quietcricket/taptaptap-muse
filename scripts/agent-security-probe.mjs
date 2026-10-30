// Trusted adversarial fixture: simulate a compromised harness, not generated mode code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dlopen, FFIType, ptr, toArrayBuffer } from 'bun:ffi';

const [otherFile, parentSecret, parentPid, canaryPort] = process.argv.slice(2);
const checks = [];
function denied(name, action) {
  assert.throws(action, undefined, name);
  checks.push(name);
}
denied('other user read', () => fs.readFileSync(otherFile));
denied('other user write', () => fs.writeFileSync(otherFile, 'changed'));
denied('server secret read', () => fs.readFileSync(parentSecret));
denied('server source read', () =>
  fs.readFileSync('/app/src/server/config.py'),
);
denied('parent environment read', () =>
  fs.readFileSync(`/proc/${parentPid}/environ`),
);
denied('server write', () =>
  fs.writeFileSync('/tmp/agent-escape-probe', 'changed'),
);
denied('config write', () =>
  fs.writeFileSync('../config/opencode.json', 'changed'),
);
fs.symlinkSync(otherFile, 'escape-link');
denied('symlink escape read', () => fs.readFileSync('escape-link'));
denied('symlink escape write', () =>
  fs.writeFileSync('escape-link', 'changed'),
);
fs.unlinkSync('escape-link');
denied('hard link escape', () => fs.linkSync(otherFile, 'escape-hardlink'));
assert.equal(process.env.AWS_ACCESS_KEY_ID, undefined);
assert.equal(process.env.AWS_SECRET_ACCESS_KEY, undefined);
assert.equal(process.env.AWS_SESSION_TOKEN, undefined);
assert.equal(process.env.META_API_KEY, 'sandbox-placeholder');
checks.push('credentials absent');

const libc = dlopen('libc.so.6', {
  socket: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  getsockname: {
    args: [FFIType.i32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  __errno_location: { args: [], returns: FFIType.ptr },
  syscall: { args: Array(7).fill(FFIType.i64), returns: FFIType.i64 },
});
const symbols = libc.symbols;
assert.equal(
  symbols.socket(1, 1, 0),
  -1,
  'Unix destination socket creation must fail',
);
const fd = symbols.socket(2, 1, 0);
assert.ok(fd >= 0);
const address = Buffer.alloc(128);
const length = Buffer.alloc(4);
length.writeUInt32LE(128);
assert.equal(symbols.getsockname(fd, ptr(address), ptr(length)), 0);
assert.equal(
  address.readUInt16LE(0),
  1,
  'Raw socket syscall must receive Unix pair, never an IP socket',
);
symbols.close(fd);
checks.push('direct socket syscall cannot create an IP socket');

const syscalls =
  process.arch === 'arm64'
    ? { ptrace: 117, seccomp: 277, unshare: 97, io_uring_setup: 425, kill: 129 }
    : {
        ptrace: 101,
        seccomp: 317,
        unshare: 272,
        io_uring_setup: 425,
        kill: 62,
      };
for (const [name, number] of Object.entries(syscalls)) {
  const args = name === 'kill' ? [BigInt(parentPid), 0n] : [0n, 0n];
  const values = [BigInt(number), ...args];
  while (values.length < 7) values.push(0n);
  assert.equal(Number(symbols.syscall(...values)), -1, `${name} should fail`);
  const error = new DataView(
    toArrayBuffer(symbols.__errno_location(), 0, 4),
  ).getInt32(0, true);
  assert.equal(error, 1, `${name} must be denied by seccomp (EPERM)`);
  checks.push(`${name} blocked`);
}
let spawned = false;
try {
  const result = Bun.spawnSync(['/bin/sh', '-c', 'echo escaped']);
  spawned = result.success;
} catch {}
assert.equal(spawned, false, 'Subprocess creation must be blocked');
checks.push('subprocess blocked');

for (const [number, flagIndex] of process.arch === 'arm64'
  ? [
      [206, 3],
      [211, 2],
      [269, 3],
    ]
  : [
      [44, 3],
      [46, 2],
      [307, 3],
    ]) {
  const values = [BigInt(number), 0n, 0n, 0n, 0n, 0n, 0n];
  values[flagIndex + 1] = 0x20000000n;
  assert.equal(Number(symbols.syscall(...values)), -1);
  assert.equal(
    new DataView(toArrayBuffer(symbols.__errno_location(), 0, 4)).getInt32(
      0,
      true,
    ),
    1,
  );
}
checks.push('TCP Fast Open bypass blocked');
libc.close();

for (const url of [
  'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
  'http://[fd00:ec2::254]/latest/meta-data/',
  `http://127.0.0.1:${canaryPort}/private-service`,
  'http://1.1.1.1/private-service',
]) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 403, `Denied destination reached: ${url}`);
  assert.ok((await response.text()).includes('Only the configured Muse API'));
  checks.push(`network denied: ${new URL(url).hostname}`);
}
const response = await fetch('http://127.0.0.1:9/v1/responses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'muse-wonder-1.0', input: 'fixture' }),
  signal: AbortSignal.timeout(3000),
});
assert.equal(response.status, 200);
assert.equal((await response.json()).ok, true);
checks.push('only approved Muse request relayed');
const worker = Bun.serve({
  hostname: '0.0.0.0',
  port: 0,
  fetch: () => new Response('private worker fixture'),
});
const internal = await fetch(`http://127.0.0.1:${worker.port}/private-worker`, {
  signal: AbortSignal.timeout(3000),
});
assert.equal(await internal.text(), 'private worker fixture');
worker.stop(true);
checks.push('only current turn private worker reachable');
fs.writeFileSync('allowed-output.txt', 'user output');
fs.writeFileSync(`${process.env.TMPDIR}/allowed-cache`, 'runtime state');
checks.push('current user workspace and runtime writes allowed');
console.log(JSON.stringify({ checks }));
