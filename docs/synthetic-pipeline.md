# Synthetic A/V pipeline (no crew footage required)

The stack can be exercised without real field videos.

## Generate + smoke

```bash
cd backend
npx tsx scripts/smokeSyntheticPipeline.ts
```

This:

1. Builds a short H.264 + AAC MP4 (`testsrc` + `sine`) via ffmpeg  
2. Confirms video **and** audio tracks  
3. Runs `prepareVideoFrames` (sparse extract + diversity)  
4. Opens a media catalog session with `hasAudio: true`  
5. Ingests a metric twin with rooms + `videoRef`

## Automated tests

```bash
cd backend
node --import tsx --test test/syntheticPipeline.test.ts
```

Helpers live in `test/helpers/syntheticAv.ts`.

## What this does **not** replace

- Live `?token=` Field Capture on a phone  
- Supabase storage PUT of a multi‑GB day file  
- RoomPlan on a LiDAR iPhone  
- LLM dictation (needs API keys + frames)

Those still need staging credentials / a device. The synthetic path proves the
A/V → frames → catalog → twin wiring stands on its own.
