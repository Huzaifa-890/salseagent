import { checkReplies } from "@/lib/inbox";
import { followups } from "@/lib/outreach";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("Unauthorized", { status: 401 });
  const replies = await checkReplies().catch((e) => [String(e)]);
  const sent = await followups();
  return Response.json({ replies, followups_sent: sent });
}
