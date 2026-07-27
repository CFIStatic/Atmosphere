import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Every driver shells out to a platform tool (xdotool, screencapture,
 * PowerShell…). These helpers exist so that always happens with an argument
 * array rather than a command string: the model supplies the text for `type`
 * actions, and passing that through a shell would let a page containing
 * `$(...)` or backticks execute code on the operator's machine.
 */

export interface RunOptions {
  /** Milliseconds before the child is killed. Screenshots need generous room. */
  timeoutMs?: number;
  /** Written to the child's stdin, then closed. */
  input?: string;
  /** Capture stdout as raw bytes instead of a UTF-8 string. */
  binary?: boolean;
  /** Cap on captured output; PNG payloads can be several megabytes. */
  maxBuffer?: number;
}

export async function run(
  file: string,
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  const { stdout } = await execFileAsync(file, args, {
    timeout: options.timeoutMs ?? 15_000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export async function runBinary(
  file: string,
  args: string[],
  options: RunOptions = {},
): Promise<Buffer> {
  const { stdout } = await execFileAsync(file, args, {
    timeout: options.timeoutMs ?? 20_000,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    encoding: 'buffer',
    windowsHide: true,
  });
  return stdout as Buffer;
}

/** True when `file` is on PATH and runnable. */
export async function hasCommand(file: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(probe, [file], { timeout: 5_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
