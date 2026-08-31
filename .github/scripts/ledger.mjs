// Generates assets/ledger-{dark,light}.svg from live GitHub data.
// No dependencies. Node 20+. Fails loudly rather than publishing an empty graph.

const USER = process.env.LEDGER_USER || "morp1e";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositories(first: 100, privacy: PUBLIC, isFork: false,
                 ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      nodes {
        name
        pushedAt
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { authorization: `bearer ${TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
});
if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
const body = await res.json();
if (body.errors) throw new Error(JSON.stringify(body.errors));

const user = body.data.user;
const days = user.contributionsCollection.contributionCalendar.weeks
  .flatMap((w) => w.contributionDays)
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(-30);
if (days.length < 30) throw new Error(`expected 30 days, got ${days.length}`);

const repos = user.repositories.nodes;
const commits30 = days.reduce((n, d) => n + d.contributionCount, 0);

const last = repos[0];
const ageDays = Math.floor((Date.now() - Date.parse(last.pushedAt)) / 86400000);
const ago = ageDays === 0 ? "today" : ageDays === 1 ? "1d ago" : `${ageDays}d ago`;
const today = new Date().toISOString().slice(0, 10);

const THEMES = {
  dark: { bg: "#05060A", ink: "#F2F4F8", dim: "#6B7280", accent: "#8B5CFF" },
  light: { bg: "#F2F4F8", ink: "#05060A", dim: "#6B7280", accent: "#6E2BFF" },
};

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const W = 800, H = 214, PAD = 28;
// Column x-offsets are hand-set, not evenly divided: LAST PUSH carries a repo name
// and needs the remaining width. Even columns overflowed it into the next label.
const stats = [
  [28, "PUBLIC REPOS", String(user.repositories.totalCount)],
  [240, "CONTRIBUTIONS · 30D", String(commits30)],
  // Time only, no repo name: the profile deliberately does not name individual repos.
  [452, "LAST PUSH", ago],
];

function render(t) {
  const label = (x, y, s, anchor = "start") =>
    `<text x="${x}" y="${y}" font-family="${MONO}" font-size="10" font-weight="500" letter-spacing="2.2" fill="${t.dim}" text-anchor="${anchor}">${esc(s)}</text>`;
  const value = (x, y, s) =>
    `<text x="${x}" y="${y}" font-family="${MONO}" font-size="14" font-weight="500" fill="${t.ink}">${esc(s)}</text>`;
  const rule = (y) =>
    `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${t.dim}" stroke-width="1" opacity="0.28"/>`;

  const cols = stats.map(([x, k, v]) => label(x, 82, k) + value(x, 106, v)).join("");

  const max = Math.max(1, ...days.map((d) => d.contributionCount));
  // The accent marks the latest day that actually has activity. Pinning it to
  // "today" painted an empty 2px stub purple, which read as a rendering fault.
  const lastActive = days.reduce((acc, d, i) => (d.contributionCount ? i : acc), -1);
  const base = 194, maxH = 40, gap = 5;
  const bw = (W - PAD * 2 - gap * (days.length - 1)) / days.length;
  const bars = days
    .map((d, i) => {
      const x = PAD + i * (bw + gap);
      const h = d.contributionCount ? Math.max(3, (d.contributionCount / max) * maxH) : 2;
      const isLatest = i === lastActive;
      const fill = isLatest ? t.accent : t.dim;
      const op = d.contributionCount ? (isLatest ? 1 : 0.85) : 0.3;
      return `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" opacity="${op}"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="morp1e activity ledger: ${esc(commits30)} contributions in the last 30 days">
<title>morp1e — ledger</title>
<rect width="${W}" height="${H}" fill="${t.bg}"/>
${label(PAD, 40, "LEDGER")}
${label(W - PAD, 40, `GENERATED ${today}`, "end")}
${rule(56)}
${cols}
${rule(126)}
${label(PAD, 150, "CONTRIBUTIONS · LAST 30 DAYS")}
${bars}
</svg>
`;
}

const { writeFileSync } = await import("node:fs");
for (const [name, theme] of Object.entries(THEMES))
  writeFileSync(`assets/ledger-${name}.svg`, render(theme));

console.log(`ledger: ${user.repositories.totalCount} repos · ${commits30} contributions/30d · last push ${last.name} ${ago}`);
if (commits30 === 0)
  console.warn("WARNING: 0 contributions in 30 days. Check Settings > Profile > Include private contributions.");
