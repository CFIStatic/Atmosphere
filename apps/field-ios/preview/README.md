# Field Capture — iOS browser host

Phone-framed preview of the Swift client in `apps/field-ios/`.
It is for walking the App Store screens in a browser. It does **not**
upload day films or replace Xcode / TestFlight.

```bash
bash scripts/host-ios-preview.sh
```

Open `http://127.0.0.1:5175/`. The Vite app also mounts this folder at `/ios`.

| Query | Effect |
|---|---|
| `?screen=today` | Jump straight to Today |
| `?screen=recording` | Start a preview day film |
| `?screen=door` | Open the door checks |

Preview join codes that resolve an office name: `COASTAL`, `ATMOSPHERE`, `DEMOOFFICE`.
