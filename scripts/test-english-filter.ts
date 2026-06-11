/**
 * Quick smoke test for isLikelyNonEnglish() to make sure we drop the bad
 * non-English Eventbrite rows but keep legitimate English news that
 * happens to mention foreign names.
 */
import { isLikelyNonEnglish } from "../server/ingest/normalize.js";

const cases: Array<{ title: string; summary?: string; expected: boolean }> = [
  // ---- Should be REJECTED (non-English) ----
  { title: "Webinaire gratuit : droits et devoirs des assistantes maternelles", expected: true },
  { title: "Capacitación para educadores comunitarios de Saprea", expected: true },
  { title: "Encuentro exclusivo con Santiago Díaz", expected: true },
  { title: "Sessió informativa: CFGS en Comerç Internacional i Transport i Logística", expected: true },
  { title: "Live découverte : filière Cybersécurité - 11/06/26", expected: true },
  { title: "Grupo Trilhar - Jun 26: Vivências e vínculos: o papel da família adotiva", expected: true },
  { title: "Design Thinking & Criatividade aplicada à Gestão de Projetos", expected: true },
  // ---- Should be KEPT (legitimate English news with one foreign name) ----
  { title: "Belgium winger Jérémy Doku expected to be available for his team's World Cup opener against Egypt", expected: false },
  { title: "Billings Mustangs know they're a 'great team' and ready to keep foot on the gas", expected: false },
  { title: "The Dead South", summary: "Live at KettleHouse Amphitheater with Amigo the Devil. Doors 6:30PM, Show 8:00PM.", expected: false },
  { title: "Stillwater Mine hires 150 workers after 2024 layoffs", expected: false },
  { title: "Tester announces $4.2M for Havre water infrastructure improvements", expected: false },
  { title: "Bozeman School District names new superintendent for 2026-27 year", expected: false },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const actual = isLikelyNonEnglish(c.title, c.summary);
  const ok = actual === c.expected;
  if (ok) pass++;
  else fail++;
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} expected=${c.expected} actual=${actual} :: ${c.title.slice(0, 80)}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
