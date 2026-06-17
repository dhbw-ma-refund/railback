import type { Ticket, User } from '../types';

// Deterministic mock data — enough to populate the tables and KPIs realistically.

const FIRST_NAMES = [
  'Anna', 'Lukas', 'Sophie', 'Maximilian', 'Mia', 'Paul', 'Emma', 'Jonas',
  'Hannah', 'Felix', 'Lea', 'Noah', 'Marie', 'Leon', 'Lina', 'Finn',
  'Clara', 'Elias', 'Laura', 'Ben', 'Julia', 'Henry', 'Sara', 'Tim',
];
const LAST_NAMES = [
  'Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner',
  'Becker', 'Schulz', 'Hoffmann', 'Schäfer', 'Koch', 'Bauer', 'Richter',
  'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann',
];
const STATIONS = [
  'Berlin Hbf', 'München Hbf', 'Hamburg Hbf', 'Köln Hbf', 'Frankfurt(M) Hbf',
  'Stuttgart Hbf', 'Mannheim Hbf', 'Leipzig Hbf', 'Hannover Hbf', 'Nürnberg Hbf',
  'Dresden Hbf', 'Bremen Hbf', 'Düsseldorf Hbf', 'Karlsruhe Hbf', 'Freiburg Hbf',
];

function rand(seed: number) {
  // Tiny LCG for deterministic output.
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const r = rand(42);
const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];

function pad(n: number, w = 4) {
  return n.toString().padStart(w, '0');
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(8, 0, 0, 0);
  return d.toISOString();
}

function isoDaysFromNow(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(8 + Math.floor(r() * 12), Math.floor(r() * 60), 0, 0);
  return d.toISOString();
}

// --- Users ----------------------------------------------------------------

export const seedUsers = (): User[] => {
  const out: User[] = [];
  const N = 42;
  for (let i = 0; i < N; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const name = `${first} ${last}`;
    const id = `U-${pad(1000 + i)}`;
    out.push({
      id,
      name,
      email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@example.de`,
      age: 18 + Math.floor(r() * 60),
      phone: `+49 ${100 + Math.floor(r() * 900)} ${1000000 + Math.floor(r() * 8999999)}`,
      status: r() < 0.92 ? 'active' : 'blocked',
      totalRefunds: Math.round(r() * 480) * (r() < 0.4 ? 1 : 0),
      createdAt: isoDaysAgo(Math.floor(r() * 700)),
    });
  }
  return out;
};

// --- Tickets --------------------------------------------------------------

export const seedTickets = (users: User[]): Ticket[] => {
  const out: Ticket[] = [];
  const N = 120;
  const statuses: Ticket['status'][] = [
    'booked', 'booked', 'booked', 'pending', 'pending',
    'used', 'used', 'cancelled', 'refunded',
  ];
  for (let i = 0; i < N; i++) {
    let src = pick(STATIONS);
    let dst = pick(STATIONS);
    while (dst === src) dst = pick(STATIONS);
    const status = statuses[Math.floor(r() * statuses.length)];
    const futureish = status === 'booked' || status === 'pending';
    out.push({
      id: `T-${pad(50000 + i, 5)}`,
      source: src,
      destination: dst,
      departure: futureish
        ? isoDaysFromNow(1 + Math.floor(r() * 60))
        : isoDaysAgo(1 + Math.floor(r() * 120)),
      price: Math.round((19 + r() * 230) * 100) / 100,
      class: r() < 0.18 ? 'first' : 'second',
      status,
      passengerId: pick(users).id,
      trainNumber: `ICE ${100 + Math.floor(r() * 900)}`,
      createdAt: isoDaysAgo(2 + Math.floor(r() * 200)),
    });
  }
  return out;
};
