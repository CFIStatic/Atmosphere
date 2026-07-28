#!/usr/bin/env node
import { ComputerController } from './computer.js';
import {
  loadCredentials,
  pair,
  parseOptions,
  saveCredentials,
  websocketUrl,
  type StoredCredentials,
} from './config.js';
import { createDriver } from './drivers/index.js';
import { PROTOCOL_VERSION, type ServerMessage } from './protocol.js';
import { AgentTransport } from './transport.js';

const VERSION = '1.0.0';

/**
 * Atmosphere computer-use agent.
 *
 * Run this on the computer you want Claude to operate. It pairs once with your
 * Atmosphere backend, then keeps an outbound connection open and executes the
 * screenshot / mouse / keyboard actions the model asks for.
 *
 *   atmosphere-agent --server https://atmosphere.example.com --code ABCD-EFGH
 *
 * After the first run the pairing code is no longer needed:
 *
 *   atmosphere-agent
 */
async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  banner(options.serverUrl);

  // 1. Establish the machine can actually be driven, before promising the
  //    server anything. A driver that cannot find xdotool should say so here,
  //    to somebody reading a terminal, not halfway through a task.
  process.stdout.write('Checking this computer… ');
  const driver = await createDriver();
  const controller = new ComputerController(driver);
  const screen = await controller.realScreenSize();
  process.stdout.write(`ok (${driver.name}, ${screen.width}×${screen.height})\n`);

  // 2. Enrol.
  const credentials = await resolveCredentials(options);
  // eslint-disable-next-line no-console
  console.log(`Paired as "${credentials.name}" (${credentials.agentId}).\n`);

  // 3. Stay connected and serve actions.
  const transport = new AgentTransport(
    websocketUrl(credentials.serverUrl),
    credentials.agentToken,
    {
      onOpen: () => {
        // eslint-disable-next-line no-console
        console.log('[agent] connected — waiting for tasks. Press Ctrl+C to stop.');
        void (async () => {
          const size = await controller.realScreenSize();
          transport.send({
            t: 'hello',
            protocol: PROTOCOL_VERSION,
            name: credentials.name,
            platform: process.platform,
            agentVersion: VERSION,
            screen: size,
            capabilities: controller.capabilities(),
          });
        })();
      },

      onMessage: (message) => void handleMessage(message, controller, transport),

      onClose: (reason) => {
        // eslint-disable-next-line no-console
        console.log(`[agent] disconnected (${reason}).`);
      },
    },
  );

  transport.start();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      // eslint-disable-next-line no-console
      console.log('\n[agent] shutting down.');
      transport.stop();
      process.exit(0);
    });
  }
}

async function handleMessage(
  message: ServerMessage,
  controller: ComputerController,
  transport: AgentTransport,
): Promise<void> {
  switch (message.t) {
    case 'ping':
      transport.send({ t: 'pong' });
      return;

    case 'configure':
      controller.configure(message.capture);
      // eslint-disable-next-line no-console
      console.log(
        `[agent] capture set to ${message.capture.width}×${message.capture.height} ` +
          `(${Math.round(message.capture.scale * 100)}% of native).`,
      );
      return;

    case 'invoke': {
      try {
        const output = await controller.execute(message.action);
        if (message.purpose === 'model') logAction(message.action);
        transport.send({ t: 'result', id: message.id, ok: true, output });
      } catch (err) {
        const reason = (err as Error).message;
        // Failures are reported back rather than thrown away: Claude can adapt
        // to "that element is not there" if it is told, and cannot if the run
        // just stalls.
        // eslint-disable-next-line no-console
        console.warn(`[agent] ${message.action.action} failed: ${reason}`);
        transport.send({ t: 'result', id: message.id, ok: false, error: reason });
      }
      return;
    }

    default:
      return;
  }
}

/** Reuse a stored token when we have one; otherwise redeem a pairing code. */
async function resolveCredentials(options: ReturnType<typeof parseOptions>): Promise<StoredCredentials> {
  if (!options.reset) {
    const stored = await loadCredentials(options.configPath);
    // A token is bound to the server that issued it, so a changed --server
    // means re-pairing rather than reusing a token the new host cannot verify.
    if (stored && stored.serverUrl === options.serverUrl && !options.pairCode) {
      return stored;
    }
  }

  if (!options.pairCode) {
    throw new Error(
      'This computer is not paired yet.\n' +
        '  1. Open Atmosphere → Computer Use → "Add a computer" to get a pairing code.\n' +
        `  2. Run:  atmosphere-agent --server ${options.serverUrl} --code YOUR-CODE`,
    );
  }

  process.stdout.write('Pairing with Atmosphere… ');
  const credentials = await pair(options.serverUrl, options.pairCode, options.name);
  await saveCredentials(options.configPath, credentials);
  process.stdout.write('ok\n');
  return credentials;
}

function logAction(action: { action: string; coordinate?: [number, number]; text?: string }): void {
  const target = action.coordinate ? ` at (${action.coordinate[0]}, ${action.coordinate[1]})` : '';
  const text = action.text ? ` "${truncate(action.text, 40)}"` : '';
  // eslint-disable-next-line no-console
  console.log(`[agent] ${action.action}${target}${text}`);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function banner(serverUrl: string): void {
  // eslint-disable-next-line no-console
  console.log(
    `\nAtmosphere computer-use agent v${VERSION}\n` +
      `Server: ${serverUrl}\n` +
      'This computer can be seen and controlled while the agent is running.\n',
  );
}

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
