export type FollowAccount = {
  order: number;
  name: string;
  handle: string;
  why: string;
};

/** Research accounts Moonshot is built from — not pick sheets. */
export const MOONSHOT_FOLLOWS: FollowAccount[] = [
  {
    order: 1,
    name: "Tom Tango",
    handle: "tangotiger",
    why: "Statcast architect. Barrels, tanks, and the windows we count.",
  },
  {
    order: 2,
    name: "Eno Sarris",
    handle: "enosarris",
    why: "Stuff+ / Location+. The arm as stuff, not ERA.",
  },
  {
    order: 3,
    name: "Kevin Roth",
    handle: "KevinRothWx",
    why: "Wind early, rain late. Pull-side vs spray.",
  },
  {
    order: 4,
    name: "Matt Pierson",
    handle: "Fearson111",
    why: "Cooled bat, softened air, quality ahead of the box.",
  },
  {
    order: 5,
    name: "FanGraphs",
    handle: "fangraphs",
    why: "Barrel risers. Bat speed maps to HR/FB.",
  },
  {
    order: 6,
    name: "Driveline",
    handle: "DrivelineBB",
    why: "Bat speed to EV to carry. The engine, not the box.",
  },
];
