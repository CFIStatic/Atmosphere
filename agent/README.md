# Atmosphere computer-use agent

Run this on a computer you want Claude to see and operate. It takes screenshots,
sends them to Atmosphere, and performs the mouse and keyboard actions the model
asks for.

```bash
npx atmosphere-agent --server https://atmosphere.example.com --code ABCD-EFGH
```

Get the pairing code from **Atmosphere → Computer Use → Add a computer**. After
the first run the code is no longer needed — the agent stores a token under
`~/.atmosphere/agent.json` (owner-readable only) and reconnects on its own:

```bash
npx atmosphere-agent
```

The agent only ever dials **out**. Nothing listens on a port, so a laptop behind
NAT or a corporate firewall works with no network changes.

## Requirements

Node.js 18 or newer, plus whatever your platform needs to be driven:

| Platform | Needs | Install |
| --- | --- | --- |
| **macOS** | Nothing extra. Grant **Screen Recording** and **Accessibility** to the terminal running the agent (System Settings → Privacy & Security). | — |
| **Windows** | Nothing extra — screen capture and input go through built-in PowerShell and Win32 calls. | — |
| **Linux (X11)** | `xdotool` for input, plus any one of ImageMagick / `scrot` / `gnome-screenshot` / `maim` / `grim` for capture. | `sudo apt install xdotool imagemagick` |

The agent checks all of this at startup and tells you exactly what is missing
rather than failing partway through a task.

**Wayland:** input is delivered through X11, so under a Wayland session it
reaches XWayland applications only. Native-Wayland windows will ignore it. Log
in to an X11/Xorg session for full control; the agent warns you at startup.

**macOS scrolling** needs the CoreGraphics event path, which requires
Accessibility permission. Without it the agent still runs — it just does not
advertise `scroll` as a capability, so Claude is told up front instead of
discovering it through a failed action.

## Options

| Flag | Environment variable | Default |
| --- | --- | --- |
| `--server <url>` | `ATMOSPHERE_SERVER` | `http://localhost:4000` |
| `--code <pairing code>` | `ATMOSPHERE_PAIR_CODE` | — (only needed once) |
| `--name <label>` | `ATMOSPHERE_AGENT_NAME` | the machine's hostname |
| `--config <path>` | `ATMOSPHERE_CONFIG` | `~/.atmosphere/agent.json` |
| `--reset` | — | discard stored credentials and pair again |

## What it can do

The full action set of Anthropic's `computer_20251124` tool: screenshot, zoom,
cursor position, mouse move, left/right/middle click, double and triple click,
mouse down/up, click-drag, scroll, type, key, hold key, and wait. Modifier keys
(`shift`, `ctrl`, `cmd`, `alt`) can be held during clicks and scrolls.

Screenshots are downscaled locally before they are sent, and Claude's
coordinates are scaled back up before the mouse moves. This matters: if an
oversized screenshot were downscaled by the API instead, the model would answer
in a coordinate space nothing on this side ever computed, and every click would
land in the wrong place. On a Retina Mac the same conversion also bridges
screenshot pixels and CoreGraphics points.

## Running it from source

```bash
cd agent
npm install
npm run build
node dist/index.js --server http://localhost:4000 --code ABCD-EFGH
```

`npm run dev` runs it straight from TypeScript without a build step.

## Security

While the agent is running, whoever can start a task in your Atmosphere
organization can control this computer. Treat it like handing someone the
keyboard:

- **Stopping the agent revokes access immediately.** Ctrl+C is the off switch,
  and there is no way back in until you start it again.
- The stored token is scoped to one organization and one server. Rotating
  `AGENT_TOKEN_SECRET` on the backend unpairs every computer at once.
- Run it under a user account with only the access the work needs. The agent can
  do anything the logged-in user can do.
- Every action is streamed to the Atmosphere console, screenshot included, so
  the run is watchable while it happens rather than only auditable afterwards.
