import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { todayISODateET } from "@/lib/mlb/format";
import { PARK_HR_FACTOR } from "@/lib/mlb/parks";
import { parseDateSearch } from "@/lib/search";

export const Route = createFileRoute("/model")({
  validateSearch: parseDateSearch,
  component: ModelPage,
});

const PARK_ROWS: Array<{ name: string; id: number }> = [
  { name: "Coors Field", id: 19 },
  { name: "Great American Ball Park", id: 2602 },
  { name: "Yankee Stadium", id: 3313 },
  { name: "Citizens Bank Park", id: 2681 },
  { name: "Rate Field", id: 4 },
  { name: "Globe Life Field", id: 5325 },
  { name: "Chase Field", id: 15 },
  { name: "Dodger Stadium", id: 22 },
  { name: "Fenway Park", id: 3 },
  { name: "American Family Field", id: 32 },
  { name: "Camden Yards", id: 2 },
  { name: "Daikin Park", id: 2392 },
  { name: "Wrigley Field", id: 17 },
  { name: "Truist Park", id: 4705 },
  { name: "Rogers Centre", id: 14 },
  { name: "Citi Field", id: 3289 },
  { name: "Nationals Park", id: 3309 },
  { name: "Angel Stadium", id: 1 },
  { name: "Target Field", id: 3312 },
  { name: "Comerica Park", id: 2394 },
  { name: "loanDepot park", id: 4169 },
  { name: "Busch Stadium", id: 2889 },
  { name: "Tropicana Field", id: 12 },
  { name: "Petco Park", id: 2680 },
  { name: "T-Mobile Park", id: 680 },
  { name: "PNC Park", id: 31 },
  { name: "Oracle Park", id: 2395 },
  { name: "Kauffman Stadium", id: 7 },
];

function ModelPage() {
  const { date } = Route.useSearch();
  const parks = [...PARK_ROWS].sort(
    (a, b) => (PARK_HR_FACTOR[b.id] ?? 100) - (PARK_HR_FACTOR[a.id] ?? 100),
  );

  return (
    <Shell date={date ?? todayISODateET()}>
      <article className="mx-auto max-w-2xl">
        <p className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">Methodology</p>
        <h1 className="mt-1 font-display text-4xl leading-[1.12] sm:text-5xl">
          A stack, not a hunch.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Moonshot is built to be calibrated, not loud. Season rates are shrunk hard, last-week
          form stops at yesterday, and P(HR) is the chance he goes yard <em>against this starter</em>
          — leftover PA to the bullpen is off the rank. The published number is pulled toward the
          ~8% vs-starter base rate, more so when the card is projected or the sample is thin.
        </p>

        <Formula />

        <Section title="Daily air">
          Park and weather are one number, in the Ballpark Pal sense — not a static 100-index with
          a separate wind tax. Temperature around 72°F is neutral. Wind of 5+ mph is aimed at LF,
          CF, or RF and boosted when it matches the hitter's pull side (Yankee porch, Camden RF,
          etc.). A posted "L to R" / "R to L" is a cross breeze toward that foul line. Domes, a
          closed roof, and a Calm reading kill the wind term. Dewpoint is leftover carry after the
          3-year park already baked in climate: 58°F dew is a typical MLB evening. Moist air is
          lighter (Nathan); dry air is denser. The effect is small versus temperature and altitude
          — capped near ±2 index points so Coors is not taxed twice for being dry. The slate badge
          is that day's expected homer tilt for the yard.
        </Section>
        <Section title="Contact">
          Barrels still lead — Statcast barrels are batted balls at 98+ mph in a launch window that
          widens with exit velocity, as a share of BBE. Blast (squared-up + 75+ mph swing) is not a
          home-run event by itself; ground-ball squarers blast too. Blast only enters contact when
          the hitter also lives in the air (20%+ fly or 30%+ sweet-spot). Sweet-spot (8–32°) fills
          the launch-window gap when barrels are middling.
        </Section>
        <Section title="Tanks vs barrels">
          A tank is one batted ball: 102+ mph, 20–38° launch, pulled to the power side (15°+ spray
          toward LF for RHB, RF for LHB). Counted from the last 10 days of Statcast BBE — not a
          rate. Barrels are a season (or week) rate of any 98+ mph ball in Statcast’s expanding
          launch window, including opposite-field and 98 mph contact. Form uses tanks (≥3 last 10,
          or one last game) instead of raw 100+ EV when both fire, so a hard grounder does not
          fake a homer heater.
        </Section>
        <Section title="Spray × park">
          A pull-air hitter gets more of a porch and more of a wall tax. Yankee is short in both
          corners (314 RF, 318 LF); Fenway taxes HR both ways — the Monster eats RHB dingers.
          Spray scales that hand overlay by this hitter's pull × fly-ball rate. Parks without a
          hand split skip the overlay.
        </Section>
        <Section title="Pitch mix">
          The 6-week matchup matrix is in the number, not just the badge. Each of the starter’s
          pitches (8%+ usage) is weighted by how the hitter has barreled and ISO’d that type. A
          four-seam he throws 35% into 30% barrels lifts the pitcher term; a changeup-heavy mix
          the hitter has not touched cuts it. Last-week mix is the fallback when the 45-day table
          is thin on that code.
        </Section>
        <Section title="100+ mph">
          Exit velocity of 100+ in the last game is a form bump. Two-plus 100+ batted balls across
          the last three is a smaller one. Four-plus in the last three — the public “they’re on
          time” screen — stacks on top. A 105 mph last night still counts even if it was a single,
          not a barrel.
        </Section>
        <Section title="Pull air">
          About two-thirds of home runs are pulled. Last-week spray from Savant (hc_x / hc_y) sets
          pull%. Below 33% pull is a form tax. 40%+ pull with 18%+ of batted balls as pulled flies
          or liners is a lift — the same pull-air cut the public boards use, shrunk so a three-game
          spray cannot run the table.
        </Section>
        <Section title="Ideal attack angle">
          Statcast bat-tracking attack angle of 5–20° is the “ideal” window. Last-week share of
          batted balls in that window, with 8+ readings, bumps at 55%+ and taxes below 35%. Season
          mean attack angle stays in the batter term; this is the week-to-week on-time read.
        </Section>
        <Section title="Launch 20–30°">
          Mean launch angle of 20–30° in each of the last three games (2+ BBE) is a form bump.
          Three of the last five with that band is a smaller one. It is the “in the air, not on
          the ground” streak — barrels already capture the best contact; this catches a hitter
          living in the HR window without a barrel binge.
        </Section>
        <Section title="Bat speed">
          Season swing speed from Savant sits in the batter term (league ~72 mph; 75+ is the public
          cut). Last-week bat speed that cools 2+ mph vs season is a form tax — the same fade as
          excluding a cooled bat.
        </Section>
        <Section title="Last-week barrels vs L/R">
          The last seven days of batted balls from Baseball Savant replace last-10 homer count as
          form. The window is [slate − 7, slate) — today's contact never grades today's card, so a
          live East Coast barrel cannot leak onto a West Coast look. Barrel rate is Bayesian-shrunk
          toward the player's season mark so a 4-for-10 week cannot run the table. Against a listed
          starter, last-week barrels vs that hand (LHP/RHP) feed the platoon term.
        </Section>
        <Section title="Zone fit">
          Last-week barrels in the heart of the zone (Statcast 4–6) vs chase (11–14) are matched
          to the starter's in-zone rate. A heart-barrel hitter against an in-zone arm is a lift;
          the same hitter against an expander is a cut. Sample is small, so the term is capped
          and only fires when the tilt is clear.
        </Section>
        <Section title="True platoon">
          Generic same-side tax is only the prior. Season HR/PA vs that hand (30+ PA) takes 65% of
          the platoon weight. Then last-week barrels vs that hand, if there are 6+ batted balls,
          blend in. Mayo vs lefties shows up; a righty masher against a tough LHP does not.
        </Section>
        <Section title="Statcast contact">
          Season HR totals lag. Barrel rate (correlation ~0.73 with home runs), exit velocity, and
          xISO from Baseball Savant now drive most of the batter term. Solid contact — the Statcast
          bucket just under a barrel — is the consistency piece: high solid% with 12%+ barrels is
          a hitter living in the top of the contact spectrum, not a two-barrel week. xISO is the
          extra-base half of xSLG (the public .450 xSLG cut is roughly this). Pull × fly-ball rate
          is a smaller bump. League barrel rate sits around 7%; 12%+ is the cut for a true power
          look.
        </Section>
        <Section title="Weak contact">
          Savant does not publish season Weak% on the public leaderboard. Last-week batted balls
          fill it: launch-speed-angle bucket 1. A week that is 18%+ weak is a form tax — the
          inverse of high solid / high barrel.
        </Section>
        <Section title="Air starters">
          Pitcher HR/BF is blended with barrels allowed, fly-ball rate, and exit velocity allowed.
          An arm that is giving up 91 EV is still a HR look even if the barrels have not caught up
          yet. Pitcher K% is a small volume term on top: league is about 22%. A 16% K arm puts more
          balls in play, so the same barrel rate yields more homers. A 30% K arm does the reverse.
          The blend is capped near ±18% so a swing-and-miss ace cannot hide a 12% barrel rate, and
          a contact guy cannot invent air.
        </Section>
        <Section title="K, whiff, WHIP">
          Pitcher K% is in the stack. Whiff% is the process behind it — shown on the card and the
          pitchers-to-target list, not double-counted. WHIP is traffic (hits + walks per inning).
          It is a run stat, not an air stat: a 1.40 WHIP sinker guy can still be a HR fade. It sits
          on the card as a reference. Hitter K% and whiff are the three-true-outcomes profile, not
          a tax — Judge and Raleigh live there.
        </Section>
        <Section title="Shrinkage">
          Batter HR/PA uses a 140-PA prior; pitcher HR/BF uses 220 BF. Call-ups and two-start
          samples cannot dominate the board. Last-week form is capped near ±20%. Single-season park
          reads are pulled most of the way back to the 3-year index.
        </Section>
        <Section title="Park × hand">
          The venue index starts from the 3-year HR park factor, then takes a shrunk step toward
          this season's home vs away HR/PA (centered on the league home/away split so talent does
          not masquerade as the yard). Left/right overlays stay: Yankee Stadium lifts left-handed
          pull; Fenway taxes it; Oracle's right-center does the same. Switch-hitters take the
          midpoint.
        </Section>
        <Section title="Calibration">
          A 1–9 hitter goes yard vs the starter about 8% of the time (league HR/PA on ~2.5 PA).
          Stacks are damped, then a light stability blend keeps thin looks from hugging 8%.
          Anything published above 16% keeps only 55% of the excess and caps at 22%. Ranking is
          unchanged by that shrink; the number on the card is quieter.
        </Section>
        <Section title="PA vs the starter">
          Expected PA is this arm’s batters faced per start (shrunk toward 23), split down the 1–9
          by times through the order. A 5.2-inning guy is ~20 TBF: the 1-hole gets about 3 looks,
          the 9-hole about 2. The rest of a full game (~1.5–2 PA) is the bullpen and is not in
          P(HR). Openers and two-start samples shrink hard.
        </Section>
        <Section title="Lock">
          Once every nine is official, or a game on the slate is live, that day’s P(HR) is frozen.
          Refresh still pulls boxes and who went yard. It does not re-rank last night after the
          barrels land. Past dates with no lock are marked rebuilt — season Statcast can include
          that night, so treat those grades as slightly leaky.
        </Section>
        <Section title="Pitchers to target">
          The board ranks tonight’s starters by air allowed (the same pitcher term on every hitter
          card), with park as a tilt — not a second ranking of hitters. Arms under 60 batters faced
          are left off; a 18-BF call-up at Yankee Stadium is unknown, not vulnerable. 9.5%+ barrels
          allowed or a 1.15× pitcher factor is loud. Each row lists the three loudest looks against
          that arm. Tap a name to open the matchup card.
        </Section>
        <Section title="HR signal">
          Each card grades eight research bars against published cuts — that is the reference, not
          a hunch. Barrels (12%+) and a pitch match count double. A pitch match is the starter’s
          10%+ pitch the hitter actually damages (12%+ barrels or .200 ISO, 4+ batted balls) — not
          just whatever is listed first in the mix. Then xISO (.200+), platoon, park air (108+),
          pitcher air, last-week form, and batting 1–4. Loud is 7+ weighted points. Live is 5–6.
          P(HR) is the size of the look. The signal is why it is a home-run candidate: a thesis,
          the key pitch circled on the matrix, and each bar next to its cut.
        </Section>
        <Section title="Matchup matrix">
          Open a card and you get the pitcher’s mix next to what the hitter has done to those same
          pitches — type, share, barrels, EV, ISO, wOBA, HR — on batted balls from the last six
          weeks. Green is damage (good for the hitter). The key match row is ringed: that is the
          pitch the starter actually throws that this hitter has been barreling. Pitcher % is
          arsenal usage; the count is batted balls, not pitches thrown.
        </Section>
        <Section title="Walk-forward">
          Opening Day through yesterday. Last 5 / last 10 / season windows, plus season HR/PA × air
          and rolling last-5 / last-10 game rankers. Graded days are written to disk; reopening
          does not rebuild the season. Only new finals (or a model-version change) add work. The
          first fill of a new version still takes a few minutes.
        </Section>
        <Section title="Stability">
          Official lineup, a starter with a real BF sample, and 80+ PA on the batter make a look
          Stable. Projected nines, TBD arms, and cup-of-coffee bats are Fair or Thin — still
          ranked, but shrunk. Use the Stable filter on the board to hide the rest.
        </Section>
        <Section title="Platoon">
          Same-side matchups are taxed; opposite-side and typical switch-vs-right get a bump.
          Handedness comes from the live MLB people feed.
        </Section>
        <Section title="Order">
          Leadoff is given about 4.5 PA; the nine-hole about 3.55. P(HR) is{" "}
          <span className="font-mono text-fg">1 − (1 − p)ⁿ</span>, then calibrated. On a final
          slate the board also prints a Brier score and predicted-vs-actual buckets.
        </Section>

        <h2 className="mt-12 font-display text-3xl tracking-tight">Park index</h2>
        <p className="mt-2 text-sm text-muted">100 is average. Used as a multiplier on p(HR/PA).</p>
        <ol className="mt-6 divide-y divide-border overflow-hidden rounded-3xl bg-surface shadow-hair">
          {parks.map((p, i) => {
            const v = PARK_HR_FACTOR[p.id] ?? 100;
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-6 font-mono text-xs tabular-nums text-subtle">{i + 1}</span>
                <span className="flex-1 text-sm">{p.name}</span>
                <span className="w-24">
                  <span className="block h-1.5 overflow-hidden rounded-full bg-bg">
                    <span
                      className="block h-full rounded-full bg-accent/80"
                      style={{ width: `${Math.min(100, ((v - 80) / 45) * 100)}%` }}
                    />
                  </span>
                </span>
                <span className="w-8 text-right font-mono text-sm tabular-nums">{v}</span>
              </li>
            );
          })}
        </ol>

        <p className="mt-10 text-sm leading-relaxed text-subtle">
          Inputs refresh from the MLB Stats API. Lineups that are not posted yet are projected
          from each club's last game. This is a research model, not advice.
        </p>
      </article>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
    </section>
  );
}

function Formula() {
  return (
    <div className="mt-8 rounded-3xl bg-surface px-5 py-5 shadow-hair">
      <p className="text-[11px] tracking-[0.14em] text-muted uppercase">Specification</p>
      <p className="mt-3 font-mono text-sm leading-relaxed text-fg">
        p<sub>PA</sub> = lg × (batter<sub>HR+barrels+bat</sub> × pitcher<sub>HR+air+mix</sub> ×
        air<sub>park+weather</sub> × platoon × form)<sup>0.62</sup>
      </p>
      <p className="mt-2 font-mono text-sm leading-relaxed text-muted">
        P<sub>raw</sub> = 1 − (1 − p<sub>PA</sub>)<sup>PA vs SP</sup>
      </p>
      <p className="mt-2 font-mono text-sm leading-relaxed text-muted">
        P(HR) = 0.077 + (P<sub>raw</sub> − 0.077) × trust(stability)
      </p>
      <p className="mt-2 font-mono text-sm leading-relaxed text-muted">
        {"if P > 0.16: P = 0.16 + 0.55 × (P − 0.16), then cap at 0.22"}
      </p>
    </div>
  );
}
