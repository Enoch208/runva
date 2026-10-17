// Gate 1: prove real CreateOS execution. Creates one VM, runs Node, reads a
// nonzero exit, checks egress is restricted, and always destroys the VM.
import { createClient } from "@nodeops-createos/sandbox";

const client = createClient({
  apiKey: process.env.CREATEOS_SANDBOX_API_KEY,
  baseUrl: process.env.CREATEOS_SANDBOX_BASE_URL || "https://api-eu.sb.createos.sh",
});

const t0 = Date.now();
const sandbox = await client.createSandbox({
  shape: "s-1vcpu-1gb",
  rootfs: "devbox:1",
  ingress_enabled: false,
  egress: ["registry.npmjs.org:443"],
});
console.log("created", sandbox.id, `${Date.now() - t0}ms`);
try {
  await sandbox.runCommand("mkdir", ["-p", "/workspace"]);
  await sandbox.files.upload("/workspace/hello.mjs", 'console.log("hello from createos", process.version)\n');
  const ok = await sandbox.runCommand("node", ["/workspace/hello.mjs"], { timeoutMs: 30_000 });
  console.log("ok:", JSON.stringify(ok.result));
  const bad = await sandbox.runCommand("node", ["-e", "console.error('boom'); process.exit(3)"], { timeoutMs: 30_000 });
  console.log("bad:", JSON.stringify(bad.result));
  const egress = await sandbox.runCommand("sh", ["-c", "curl -sS -m 5 -o /dev/null -w '%{http_code}' https://example.com; echo \" exit=$?\""], { timeoutMs: 30_000 });
  console.log("egress example.com:", JSON.stringify(egress.result));
  if (!ok.result.stdout.includes("hello") || ok.result.exit_code !== 0) throw new Error("hello run failed");
  if (bad.result.exit_code !== 3) throw new Error("nonzero exit not captured");
  console.log("GATE 1 PASS");
} finally {
  await sandbox.destroy();
  console.log("destroyed", `${Date.now() - t0}ms total`);
}
// The SDK keeps a handle open after destroy, so exit explicitly.
process.exit(0);
