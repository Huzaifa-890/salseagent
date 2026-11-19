# AI Sales Agent (Next.js, local pehle, Vercel baad mein)

## Local chalana (koi server nahi)
1. `npm install`
2. `cp .env.example .env` aur keys bharein (ADMIN_PASSWORD, CRON_SECRET, DATABASE_* khali chhod sakte hain)
3. `npm run dev` -> http://localhost:3000
4. Dashboard: Niche + City likhein -> Find -> Audit -> Draft -> har email Review karke Send.
   Data `local.db` file mein save hota hai (sirf aapke computer par).

## Baad mein Vercel par live
1. Free Turso database banayein (turso.tech) -> DATABASE_URL aur DATABASE_AUTH_TOKEN lein
2. Code GitHub par push karein (.env push NAHI hoti) -> vercel.com par import
3. Vercel Settings > Environment Variables mein .env ki saari values daalein.
   ADMIN_PASSWORD aur CRON_SECRET (koi lamba random text) zaroori hain.
4. Deploy. `vercel.json` rozana 9am par follow-ups + reply check khud chalata hai.

## Safety
Alag sending domain, 2-3 hafte warm-up, DAILY_LIMIT 20 se shuru, har email dashboard mein dekh kar bhejein.
Footer mein address + unsubscribe line auto lagti hai. "unsubscribe" reply wale dobara kabhi email nahi paate.
