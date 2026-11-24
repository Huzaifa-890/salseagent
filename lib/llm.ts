import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();
export async function askJson(system: string, prompt: string, max = 1500) {
  const r = await client.messages.create({
    model: process.env.MODEL || "claude-sonnet-5",
    max_tokens: max,
    system: system + "\nReturn ONLY valid JSON, no markdown fences.",
    messages: [{ role: "user", content: prompt }],
  });
  const t = r.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
    .replace(/^```(?:json)?|```$/gm, "").trim();
  return JSON.parse(t);
}
