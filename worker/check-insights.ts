/**
 * Smart categories smoke test: sends one made-up order email (no real mail) through the extractor
 * with the configured model and key, and prints what came back. Useful after a deploy or when
 * trying another model (INSIGHTS_MODEL=… on the command line).
 *
 *   fly ssh console --app kolbaba-worker -C "npx tsx worker/check-insights.ts"
 */
import "dotenv/config";
import { extractWithAI } from "@/server/insights/extract";
import { env } from "@/server/env";

const sample = {
  subject: "Vaše objednávka 1029384756 je na cestě",
  from: { name: "Alza.cz", email: "objednavky@alza.cz" },
  date: new Date(),
  text: [
    "Dobrý den,",
    "vaši objednávku 1029384756 jsme předali dopravci PPL. Doručení očekávejte zítra mezi 10:00 a 14:00.",
    "Sony WH-1000XM6 1 ks 8 990 Kč",
    "Celkem k úhradě: 8 990 Kč (zaplaceno kartou)",
    "Sledovat zásilku (https://www.ppl.cz/vyhledat-zasilku?shipmentId=40712345678)",
  ].join("\n"),
};

async function main() {
  const started = Date.now();
  const { data, tokens } = await extractWithAI(sample);
  console.log(`model: ${env.insightsModel} (reasoning ${env.insightsReasoning}) · ${Date.now() - started} ms · ${JSON.stringify(tokens)}`);
  console.log(JSON.stringify(data, null, 2));
  if (data?.category !== "order") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
