export type LineupSource = "official" | "projected";

export type GameStatusKind = "preview" | "live" | "final" | "other";

export type ConfidenceBand = "stable" | "fair" | "thin";

export type MixFamily = "hard" | "break" | "off";

export type Factor = {
  value: number;
  label: string;
};

export type ArsenalPitch = {
  code: string;
  pct: number;
};

export type PitchMixRow = {
  code: string;
  name: string;
  n: number;
  pct: number;
  barrelPct: number | null;
  ev: number | null;
  iso: number | null;
  woba: number | null;
  hr: number;
};

export type PitchMatrix = {
  from: string;
  to: string;
  pitcher: PitchMixRow[];
  hitter: PitchMixRow[];
};

export type HrCheck = {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
  weight: number;
  value: number | null;
  cut: number | null;
  unit: string;
};

export type KeyPitchMatch = {
  code: string;
  name: string;
  usage: number;
  n: number;
  barrelPct: number | null;
  ev: number | null;
  iso: number | null;
  hr: number;
  loud: boolean;
};

export type HrSignal = {
  grade: "loud" | "live" | "thin" | "fade";
  passed: number;
  total: number;
  score: number;
  headline: string;
  why: string;
  missing: string | null;
  keyMatch: KeyPitchMatch | null;
  checks: HrCheck[];
};

export type PitcherInfo = {
  id: number;
  name: string;
  throws: "L" | "R" | "S";
  hr9: number | null;
  hr: number | null;
  bf: number | null;
  hardPct: number | null;
  breakPct: number | null;
  offPct: number | null;
  mixFamily: MixFamily | null;
  mixLabel: string | null;
  arsenal: ArsenalPitch[] | null;
  inZone: number | null;
  edge: number | null;
  kPct: number | null;
  whiffPct: number | null;
  whip: number | null;
  gs: number | null;
  tbfPerStart: number | null;
};

export type ParkInfo = {
  id: number;
  name: string;
  hrFactor: number;
  airIndex: number;
  deltaHr: number;
  airLabel: string;
};

export type WeatherInfo = {
  temp: string | null;
  wind: string | null;
  condition: string | null;
  humidity: number | null;
  dewpoint: number | null;
};

export type SideBarrels = { bbe: number; barrels: number; pct: number | null };

export type PlayerPrediction = {
  playerId: number;
  name: string;
  lastName: string;
  teamId: number;
  teamAbbr: string;
  opponentId: number;
  opponentAbbr: string;
  isHome: boolean;
  gamePk: number;
  gameStatus: GameStatusKind;
  gameStatusLabel: string;
  gameTime: string;
  battingOrder: number;
  position: string;
  bats: "L" | "R" | "S";
  pitcher: PitcherInfo | null;
  park: ParkInfo;
  weather: WeatherInfo;
  lineupSource: LineupSource;
  pHr: number;
  pHrRaw: number;
  xHr: number;
  expectedPa: number;
  gamePa: number;
  starterTbf: number;
  pHrPa: number;
  confidence: number;
  confidenceBand: ConfidenceBand;
  confidenceNotes: string[];
  reasons: string[];
  factors: {
    batter: Factor;
    pitcher: Factor;
    park: Factor;
    platoon: Factor;
    weather: Factor;
    form: Factor;
  };
  season: {
    hr: number;
    pa: number;
    avg: string;
    slg: string;
    ops: string;
    abPerHr: string | null;
  };
  recent: { hr: number; pa: number; games: number } | null;
  actualHr: number | null;
  statcast: {
    barrel: number | null;
    ev: number | null;
    hardHit: number | null;
    xIso: number | null;
    pull: number | null;
    flyBall: number | null;
    launch: number | null;
    swingSpeed: number | null;
    attackAngle: number | null;
    solid: number | null;
    xSlg: number | null;
    kPct: number | null;
    whiff: number | null;
    sweetSpot: number | null;
    blast: number | null;
    squaredUp: number | null;
  } | null;
  week: {
    bbe: number;
    barrels: number;
    barrelPct: number;
    ev: number | null;
    batSpeed: number | null;
    solidPct: number | null;
    weakPct: number | null;
    ev100Last1: boolean;
    ev100Last3: boolean;
    n100Last3: number;
    maxEvLast1: number | null;
    pullPct: number | null;
    pullAirPct: number | null;
    idealAaPct: number | null;
    launchBandLast3: boolean;
    launchBandLast5: boolean;
    nLaunchBandLast5: number;
    tanks: number;
    tanksLast1: boolean;
    tanksLast3: number;
    vsL: SideBarrels;
    vsR: SideBarrels;
    vsHard: SideBarrels;
    vsBreak: SideBarrels;
    vsOff: SideBarrels;
    heart: SideBarrels;
    chase: SideBarrels;
    vsPitch: Array<{ code: string; bbe: number; barrels: number; pct: number | null }>;
  } | null;
  handSplit: {
    vsL: { hr: number; pa: number; slg: string } | null;
    vsR: { hr: number; pa: number; slg: string } | null;
  } | null;
  pitchMatrix: PitchMatrix | null;
  signal: HrSignal;
};

export type GameCard = {
  gamePk: number;
  gameTime: string;
  status: GameStatusKind;
  statusLabel: string;
  venueName: string;
  park: ParkInfo;
  weather: WeatherInfo;
  away: {
    id: number;
    abbr: string;
    name: string;
    pitcher: PitcherInfo | null;
    score: number | null;
  };
  home: {
    id: number;
    abbr: string;
    name: string;
    pitcher: PitcherInfo | null;
    score: number | null;
  };
  lineupSource: LineupSource;
  combinedXhr: number;
  actualHr: number | null;
};

export type CalibRow = {
  label: string;
  n: number;
  meanP: number;
  actualRate: number;
};

export type LockLook = {
  playerId: number;
  gamePk: number;
  pHr: number;
  pHrRaw: number;
  rank: number;
};

export type LockRecord = {
  date: string;
  model: string;
  lockedAt: string;
  looks: LockLook[];
};

export type LockState = {
  status: "open" | "locked" | "rebuilt";
  at: string | null;
  model: string;
  note: string;
};

export type WalkDay = {
  date: string;
  games: number;
  n: number;
  top12WithHr: number | null;
  top12Rate: number | null;
  restRate: number | null;
  meanP: number;
  actualRate: number | null;
  brier: number | null;
  lockStatus: LockState["status"];
  baselineHits: number | null;
  baselineN: number | null;
};

export type WalkWindow = {
  key: "last5" | "last10" | "season";
  label: string;
  from: string;
  to: string;
  days: number;
  looks: number;
  top12Hits: number;
  top12Looks: number;
  top12Rate: number;
  restRate: number;
  lift: number;
  liftLo: number;
  liftHi: number;
  baselineRate: number;
  baselineHits: number;
  baselineLooks: number;
  last5Rate: number;
  last5Hits: number;
  last5Looks: number;
  last10Rate: number;
  last10Hits: number;
  last10Looks: number;
  cut16Rate: number;
  cut16N: number;
  brier: number;
  skill: number;
};

export type WalkForward = {
  model: string;
  from: string;
  to: string;
  days: number;
  looks: number;
  top12Looks: number;
  top12Hits: number;
  top12Rate: number;
  restRate: number;
  meanP: number;
  actualRate: number;
  brier: number;
  skill: number;
  logLoss: number;
  lift: number;
  liftLo: number;
  liftHi: number;
  lockedDays: number;
  rebuiltDays: number;
  baselineTop12Looks: number;
  baselineTop12Hits: number;
  baselineTop12Rate: number;
  baselineLift: number;
  cut16N: number;
  cut16Rate: number;
  below16N: number;
  below16Rate: number;
  bestDays: WalkDay[];
  worstDays: WalkDay[];
  calibration: CalibRow[];
  byDay: WalkDay[];
  windows: WalkWindow[];
  pending: number;
  totalDays: number;
};

export type PitcherTarget = {
  playerId: number;
  gamePk: number;
  name: string;
  lastName: string;
  teamAbbr: string;
  pHr: number;
  grade: HrSignal["grade"];
  keyPitch: string | null;
};

export type VulnerablePitcher = {
  pitcherId: number;
  name: string;
  throws: "L" | "R" | "S";
  teamId: number;
  teamAbbr: string;
  opponentAbbr: string;
  isHome: boolean;
  gamePk: number;
  gameTime: string;
  parkAir: number;
  parkLabel: string;
  hr: number | null;
  bf: number | null;
  hr9: number | null;
  barrelAllowed: number | null;
  evAllowed: number | null;
  flyBall: number | null;
  kPct: number | null;
  whiffPct: number | null;
  whip: number | null;
  pitcherFactor: number;
  combinedXhr: number;
  score: number;
  grade: "loud" | "live" | "thin";
  why: string;
  targets: PitcherTarget[];
};

export type BoardPayload = {
  date: string;
  season: number;
  generatedAt: string;
  league: { hrPa: number; hrBf: number };
  games: GameCard[];
  predictions: PlayerPrediction[];
  vulnerable: VulnerablePitcher[];
  lock: LockState;
  walkForward: WalkForward | null;
  summary: {
    games: number;
    modeled: number;
    officialLineups: number;
    projectedLineups: number;
    completedGames: number;
    liveGames: number;
    top12WithHr: number | null;
    meanP: number;
    top12MeanP: number;
    actualRate: number | null;
    top12Rate: number | null;
    restRate: number | null;
    actualHrLeaders: Array<{
      playerId: number;
      name: string;
      teamAbbr: string;
      actualHr: number;
      pHr: number;
    }>;
    brier: number | null;
    calibration: CalibRow[];
  };
};