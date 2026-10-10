# Long-recording eval

1. Read-only fetch (the only step that sees the service key; SELECT + signed URLs only):
   `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/eval/fetch-signed-urls.ts --longest 5 --out /workspace/video-cost/eval`
   (or `--ids a,b,c`, `--min-seconds 14400` for ≥ 4 h recordings)
2. Optional human labels: `/workspace/video-cost/eval/labels/<proofId>.json` = `{"minutes":[{"minute":0,"activity":"site_work","work":true}]}`.
   activity: site_work, walkthrough, talking, driving, break, pocket_or_dark, screen_or_media, idle, other.
3. Run (refuses if SUPABASE_SERVICE_ROLE_KEY is set; writes only to the eval dir):
   `env -u SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY=… npx tsx scripts/eval/run-eval.ts --dir /workspace/video-cost/eval --budget 150`
   Variants: reference (Gemini 3.1 Pro @10s) vs Flash-Lite @10/15/20/30s, each with and without Gemini 3.8 Flash re-reads.
4. Read `report.md`: coverage, accuracy vs labels, missed work minutes, agreement with the reference, $/min, $/h, $/8h, PASS/FAIL/UNVERIFIED.
   Without labels a `*.review.csv` per variant is written for a person to grade minute by minute.

Signed URLs expire (default 6 h, `--ttl`); re-run step 1 if they lapse. Spend is hard-capped (max $300).
