import os from 'node:os';

export function systemPerf() {
  const mem = process.memoryUsage();
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    electron: process.versions.electron,
    uptime: Math.floor(process.uptime()),
    memoryMb: Math.round(mem.rss / 1024 / 1024),
    cpus: os.cpus().length,
    hostname: os.hostname()
  };
}

export function cacheStats() {
  return { entries: 0, sizeKb: 0 };
}
