import { auditLog } from "../../audit/log.js";

export async function auditTailCommand(n: number): Promise<void> {
  const entries = await auditLog.tail(n);
  if (entries.length === 0) {
    console.log("Audit log is empty.");
    return;
  }
  for (const e of entries) {
    console.log(`#${e.seq} [${e.timestamp}] ${e.type} (${e.venue})`);
    console.log(`    ${JSON.stringify(e.payload)}`);
  }
}

export async function auditVerifyCommand(): Promise<void> {
  const result = await auditLog.verify();
  if (result.ok) {
    const all = await auditLog.all();
    console.log(`Chain OK — ${all.length} entries, hash-linked from GENESIS to seq ${all[all.length - 1]?.seq ?? "N/A"}.`);
  } else {
    console.error(`Chain BROKEN at seq ${result.brokenAtSeq}: ${result.reason}`);
    process.exitCode = 1;
  }
}
