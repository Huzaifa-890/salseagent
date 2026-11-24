# AI Sales Agent (Next.js) - IT Reliable Sales Engine

Implements the full flow: self-sourcing leads, auditing, scoring, drafting, staged
follow-ups, proposals and closing - with your approval required before anything is sent.

## Local chalana (koi server nahi)
1. `npm install`
2. `cp .env.example .env` aur keys bharein (ADMIN_PASSWORD, CRON_SECRET, DATABASE_* khali chhod sakte hain)
3. `npm run dev` -> http://localhost:3000
4. Dashboard mein "Autopilot settings" se niches/cities set karein, phir "Run autopilot now"
   dabayein - agent khud leads dhoondega, audit karega, aur draft banayega. Har email
   Review karke Send.
   Data `local.db` file mein save hota hai (sirf aapke computer par).

## Baad mein Vercel par live
1. Free Turso database banayein (turso.tech) -> DATABASE_URL aur DATABASE_AUTH_TOKEN lein
2. Code GitHub par push karein (.env push NAHI hoti) -> vercel.com par import
3. Vercel Settings > Environment Variables mein .env ki saari values daalein.
   ADMIN_PASSWORD aur CRON_SECRET (koi lamba random text) zaroori hain.
4. Deploy. `vercel.json` rozana 9am par chalata hai: naye leads dhoondna, audit, draft,
   follow-ups, aur reply check - sab khud-ba-khud (sirf naya email/proposal bhejne se
   pehle aapki approval chahiye, jab tak FOLLOWUP_AUTOSEND=1 na karein).

## What runs on its own vs. what needs your click
- **Automatic**: lead sourcing (cycles your AUTOPILOT_NICHES x AUTOPILOT_CITIES),
  website audit, lead scoring (1-10), drafting first emails, drafting follow-ups
  (day 3-4 / 8-10 / 15), drafting proposal follow-ups (day 2 / day 5), reply
  classification, bounce detection, unsubscribe handling.
- **Needs your approval in the dashboard**: sending the first email, every follow-up,
  every proposal, the agreement/deposit email. Set `FOLLOWUP_AUTOSEND=1` once you trust
  the quality to let follow-ups send themselves.

## Safety (Australian Spam Act 2003)
- Sends ramp automatically: RAMP_WEEK1 (default 15/day) -> RAMP_WEEK2 (25/day) ->
  RAMP_STEADY (40/day), plus a BATCH_SIZE/BATCH_COOLDOWN_MIN cooldown between batches.
- Any detected email bounce is logged; if the bounce rate over the last 14 days exceeds
  BOUNCE_PAUSE_THRESHOLD (default 3%), sending auto-pauses for 48 hours. You can also
  pause/resume manually from the dashboard.
- Footer mein address + unsubscribe line auto lagti hai. "unsubscribe"/"stop" reply wale
  dobara kabhi email nahi paate (suppress list).
- Separate sending domain/address use karein cold outreach ke liye - agar spam complaint
  aaye to aapka main brand surakshit rahe. Apne domain par SPF, DKIM, DMARC zaroor set
  karein (yeh DNS settings hain, code se bahar).

## CRM
The dashboard *is* the CRM (SQLite locally, Turso on Vercel) - lead score, problems
found, status, dates, next action, notes. Click "Export CRM CSV" (`/api/export`) any
time to pull it into Google Sheets if you want a copy there too.
