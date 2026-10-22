// Frontend-only data layer backed by localStorage.
// No server, no external auth. Accounts, wishes, offers, conversations and
// messages all persist in the browser so nothing resets on refresh.

export type WishCategory =
  | 'Education'
  | 'Health'
  | 'Technology'
  | 'Community'
  | 'Creative'
  | 'Other';
export type HelpType = 'funding' | 'goods' | 'time' | 'skills' | 'other';
export type WishStatus = 'open' | 'in_progress' | 'completed';
export type OfferStatus = 'pending' | 'accepted';

export type User = {
  id: string;
  name: string;
  email: string;
  // NOTE: This is a local-only demo. Passwords are stored in the browser and
  // are not secure. Do not reuse a real password here.
  password: string;
  createdAt: string;
};

export type PublicUser = Pick<User, 'id' | 'name' | 'email'>;

export type Wish = {
  id: string;
  title: string;
  description: string;
  category: WishCategory;
  helpType: HelpType;
  city: string | null;
  requesterName: string;
  ownerId: string;
  isSample: boolean;
  status: WishStatus;
  offerCount: number;
  createdAt: string;
};

export type Offer = {
  id: string;
  wishId: string;
  helperId: string;
  helperName: string;
  helpType: HelpType;
  note: string;
  status: OfferStatus;
  createdAt: string;
};

export type Conversation = {
  id: string;
  wishId: string;
  wishTitle: string;
  ownerId: string;
  helperId: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
};

export type Database = {
  users: User[];
  wishes: Wish[];
  offers: Offer[];
  conversations: Conversation[];
  messages: Message[];
};

const DB_KEY = 'wishwell:db:v2';
const SESSION_KEY = 'wishwell:session:v1';

export const now = () => new Date().toISOString();

export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

const SYSTEM_OWNER = 'system';

// Pre-made demo accounts. These let the board feel alive: they own some public
// wishes you can offer help on, and they send the pending offers that land on
// the starter wishes attached to your own account (see seedForNewOwner).
// They can be signed into as well (handy for seeing both sides of a chat).
export const DEMO_USERS: User[] = [
  { id: 'user_demo_sam', name: 'Sam Rivera', email: 'sam@demo.test', password: 'password', createdAt: '2025-02-10T09:00:00.000Z' },
  { id: 'user_demo_lena', name: 'Lena Park', email: 'lena@demo.test', password: 'password', createdAt: '2025-02-11T09:00:00.000Z' },
  { id: 'user_demo_theo', name: 'Theo Nunez', email: 'theo@demo.test', password: 'password', createdAt: '2025-02-12T09:00:00.000Z' },
];

// Read-only example wishes (owned by the system, cannot receive offers) plus a
// few public wishes owned by the demo users that a signed-in person CAN offer
// help on.
function seedWishes(): Wish[] {
  return [
    {
      id: 'wish_sample_study',
      title: 'A quiet place to study for certification exams',
      description:
        'A few hours each week in a quiet shared study space would make it easier to prepare for my certification exam.',
      category: 'Education', helpType: 'time', city: 'Salem, OR', requesterName: 'Jordan',
      ownerId: SYSTEM_OWNER, isSample: true, status: 'open', offerCount: 0,
      createdAt: '2025-02-17T13:00:00.000Z',
    },
    {
      id: 'wish_sample_garden',
      title: 'Help getting a neighborhood garden started',
      description:
        'Our block has an unused sunny corner. A little planning help and a few starter tools could turn it into a shared place to grow herbs and flowers.',
      category: 'Community', helpType: 'skills', city: 'Eugene, OR', requesterName: 'Avery',
      ownerId: SYSTEM_OWNER, isSample: true, status: 'open', offerCount: 0,
      createdAt: '2025-02-15T09:15:00.000Z',
    },
    {
      id: 'wish_demo_bike',
      title: 'A commuter bike to get to a new job',
      description:
        'I just started a job across town and the bus route takes over an hour each way. A working commuter bike would cut that down and help me keep the job.',
      category: 'Other', helpType: 'goods', city: 'Portland, OR', requesterName: 'Sam Rivera',
      ownerId: 'user_demo_sam', isSample: false, status: 'open', offerCount: 0,
      createdAt: '2025-02-19T11:00:00.000Z',
    },
    {
      id: 'wish_demo_tutoring',
      title: 'Weekend math tutoring for my daughter',
      description:
        'My daughter is falling behind in algebra and I cannot afford a tutor right now. A few weekend sessions, in person or online, would make a real difference.',
      category: 'Education', helpType: 'skills', city: 'Beaverton, OR', requesterName: 'Lena Park',
      ownerId: 'user_demo_lena', isSample: false, status: 'open', offerCount: 0,
      createdAt: '2025-02-20T15:30:00.000Z',
    },
    {
      id: 'wish_demo_winter',
      title: 'Warm coats for a family of four this winter',
      description:
        'We relocated recently and did not bring warm clothing. Gently used winter coats for two adults and two kids (ages 6 and 9) would help us through the season.',
      category: 'Community', helpType: 'goods', city: 'Gresham, OR', requesterName: 'Theo Nunez',
      ownerId: 'user_demo_theo', isSample: false, status: 'open', offerCount: 0,
      createdAt: '2025-02-21T08:45:00.000Z',
    },
  ];
}

function emptyDb(): Database {
  return {
    users: [...DEMO_USERS],
    wishes: seedWishes(),
    offers: [],
    conversations: [],
    messages: [],
  };
}

// Attaches two starter wishes to a freshly created owner, each already carrying
// pending offers from the demo users. This makes the accept -> message ->
// complete flow testable immediately after signing up, with no setup.
export function seedForNewOwner(ownerId: string, ownerName: string): { wishes: Wish[]; offers: Offer[] } {
  const ts = now();
  const laptopId = `wish_owner_${ownerId}_laptop`;
  const movingId = `wish_owner_${ownerId}_moving`;
  const wishes: Wish[] = [
    {
      id: laptopId,
      title: 'A refurbished laptop for evening classes',
      description:
        'I have started evening classes in bookkeeping and my old laptop no longer holds a charge. A reliable refurbished laptop would help me keep up with assignments.',
      category: 'Education', helpType: 'goods', city: 'Portland, OR', requesterName: ownerName,
      ownerId, isSample: false, status: 'open', offerCount: 2, createdAt: ts,
    },
    {
      id: movingId,
      title: 'A few hands to help with a small move',
      description:
        'I am moving to a smaller apartment nearby and have a couch, a bed, and about ten boxes. An hour or two of help on a weekend would mean the world.',
      category: 'Community', helpType: 'time', city: 'Portland, OR', requesterName: ownerName,
      ownerId, isSample: false, status: 'open', offerCount: 1, createdAt: ts,
    },
  ];
  const offers: Offer[] = [
    {
      id: `offer_${ownerId}_1`, wishId: laptopId, helperId: 'user_demo_sam', helperName: 'Sam Rivera',
      helpType: 'goods', note: 'I refurbish laptops as a hobby and have a solid one with a fresh battery I can set up for you. Happy to show you how everything works.',
      status: 'pending', createdAt: ts,
    },
    {
      id: `offer_${ownerId}_2`, wishId: laptopId, helperId: 'user_demo_lena', helperName: 'Lena Park',
      helpType: 'funding', note: 'My workplace is retiring some machines next month. I could also chip in toward a refurbished one if that is easier for you.',
      status: 'pending', createdAt: ts,
    },
    {
      id: `offer_${ownerId}_3`, wishId: movingId, helperId: 'user_demo_theo', helperName: 'Theo Nunez',
      helpType: 'time', note: 'I have a pickup truck and a free Saturday this month. I can help load, drive, and unload. Just let me know which weekend works.',
      status: 'pending', createdAt: ts,
    },
  ];
  return { wishes, offers };
}

export function loadDb(): Database {
  if (typeof window === 'undefined') return emptyDb();
  try {
    const raw = window.localStorage.getItem(DB_KEY);
    if (!raw) {
      const fresh = emptyDb();
      saveDb(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<Database>;
    const db: Database = {
      users: parsed.users ?? [],
      wishes: parsed.wishes ?? seedWishes(),
      offers: parsed.offers ?? [],
      conversations: parsed.conversations ?? [],
      messages: parsed.messages ?? [],
    };
    // Make sure the demo accounts and public demo wishes exist even if an older
    // database was stored before they were introduced.
    for (const demo of DEMO_USERS) {
      if (!db.users.some((u) => u.id === demo.id)) db.users.push(demo);
    }
    for (const seeded of seedWishes()) {
      if (!db.wishes.some((w) => w.id === seeded.id)) db.wishes.push(seeded);
    }
    return db;
  } catch {
    return emptyDb();
  }
}

export function saveDb(db: Database): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function loadSessionUserId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SESSION_KEY);
}

export function saveSessionUserId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (id) window.localStorage.setItem(SESSION_KEY, id);
  else window.localStorage.removeItem(SESSION_KEY);
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email };
}
