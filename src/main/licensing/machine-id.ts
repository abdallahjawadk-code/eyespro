import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';

function winGuid(): string {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 5_000, windowsHide: true }
    );
    return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] ?? '';
  } catch { return ''; }
}

function primaryMac(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const a of ifaces ?? []) {
      if (!a.internal && a.mac && a.mac !== '00:00:00:00:00:00') return a.mac;
    }
  }
  return '';
}

/** Stable per-machine fingerprint — SHA-256 of GUID + MAC + CPU model. */
export function getMachineId(): string {
  const guid = winGuid();
  const mac  = primaryMac();
  const cpu  = os.cpus()[0]?.model ?? '';
  return createHash('sha256')
    .update(`${guid}::${mac}::${cpu}::eyespro`)
    .digest('hex')
    .slice(0, 32);
}
