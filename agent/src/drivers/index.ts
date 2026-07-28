import { DarwinDriver } from './darwin.js';
import { LinuxDriver } from './linux.js';
import { Win32Driver } from './win32.js';
import type { ComputerDriver } from './types.js';

/** Pick and verify the driver for the machine the agent is running on. */
export async function createDriver(): Promise<ComputerDriver> {
  const driver = selectDriver();
  await driver.probe();
  return driver;
}

function selectDriver(): ComputerDriver {
  switch (process.platform) {
    case 'darwin':
      return new DarwinDriver();
    case 'win32':
      return new Win32Driver();
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return new LinuxDriver();
    default:
      throw new Error(
        `Unsupported platform "${process.platform}". The agent runs on Linux (X11), macOS, and Windows.`,
      );
  }
}

export type { ComputerDriver } from './types.js';
