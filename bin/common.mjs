// Names and paths shared by server.mjs and run.mjs (mirrors lib.sh).
import fs from 'fs';

export const RUN_DIR = `/tmp/claude-brave-${process.getuid()}`;
export const validInstance = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(s);
export const paths = (inst) => ({
  sock: `${RUN_DIR}/${inst}.sock`,
  shot: (tab) => `${RUN_DIR}/${inst}-${tab.replace(/[^\w.-]/g, '_')}.png`,
});

/** The run dir (created by start.sh) must be a real directory owned by us and closed to group/others. */
export function runDirOk() {
  try {
    const st = fs.lstatSync(RUN_DIR);
    return st.isDirectory() && st.uid === process.getuid() && !(st.mode & 0o077);
  } catch { return false; }
}
