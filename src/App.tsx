import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, Redirect, Route, Switch, useLocation, useParams } from 'wouter';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp,
  Compass, HeartHandshake, Leaf, LockKeyhole, LogOut, MapPin, MessageCircle, Plus,
  Search, Send, Shield, ShieldCheck, Sparkles, UsersRound, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  loadDb, saveDb, loadSessionUserId, saveSessionUserId, makeId, now, toPublicUser, seedForNewOwner,
  type Database, type HelpType, type WishCategory, type Wish, type Offer,
  type Conversation, type Message, type PublicUser, type User,
} from '@/lib/store';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const categories: WishCategory[] = ['Education', 'Health', 'Technology', 'Community', 'Creative', 'Other'];
const helpTypes: HelpType[] = ['funding', 'goods', 'time', 'skills', 'other'];
const helpLabels: Record<HelpType, string> = { funding: 'Funding', goods: 'Goods', time: 'Time', skills: 'Skills', other: 'Other' };
const categoryNotes: Record<WishCategory, string> = {
  Education: 'Learning, school, or training', Health: 'Wellbeing and health needs',
  Technology: 'Devices and digital access', Community: 'A local project or shared need',
  Creative: 'Making, music, or creative work', Other: 'Something that does not fit elsewhere',
};

type WishDraft = { title: string; description: string; category: WishCategory; helpType: HelpType; city: string; requesterName: string };
type OfferDraft = { helperName: string; helpType: HelpType; note: string };

/* -------------------------------------------------------------------------- */
/*  Store context (real data, persisted to localStorage)                      */
/* -------------------------------------------------------------------------- */

type AuthResult = { ok: true } | { ok: false; error: string };

type StoreValue = {
  currentUser: PublicUser | null;
  signUp: (input: { name: string; email: string; password: string }) => AuthResult;
  signIn: (input: { email: string; password: string }) => AuthResult;
  signOut: () => void;
  userName: (id: string) => string;
  wishes: Wish[];
  offers: Offer[];
  conversations: Conversation[];
  messages: Message[];
  createWish: (draft: WishDraft) => Wish;
  createOffer: (wishId: string, draft: OfferDraft) => { ok: true; offer: Offer } | { ok: false; error: string };
  acceptOffer: (offerId: string) => Conversation | null;
  completeWish: (wishId: string) => void;
  sendMessage: (conversationId: string, body: string) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database>(() => loadDb());
  const [sessionId, setSessionId] = useState<string | null>(() => loadSessionUserId());

  // Persist the database whenever it changes.
  useEffect(() => { saveDb(db); }, [db]);
  useEffect(() => { saveSessionUserId(sessionId); }, [sessionId]);

  const currentUser = useMemo<PublicUser | null>(() => {
    const user = db.users.find((u) => u.id === sessionId);
    return user ? toPublicUser(user) : null;
  }, [db.users, sessionId]);

  const userName = useCallback(
    (id: string) => db.users.find((u) => u.id === id)?.name ?? 'Someone',
    [db.users],
  );

  const signUp: StoreValue['signUp'] = useCallback((input) => {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (db.users.some((u) => u.email === email)) {
      return { ok: false, error: 'An account with this email already exists. Try signing in.' };
    }
    const user: User = { id: makeId('user'), name, email, password: input.password, createdAt: now() };
    const seed = seedForNewOwner(user.id, user.name);
    setDb((current) => ({
      ...current,
      users: [...current.users, user],
      wishes: [...seed.wishes, ...current.wishes],
      offers: [...current.offers, ...seed.offers],
    }));
    setSessionId(user.id);
    return { ok: true };
  }, [db.users]);

  const signIn: StoreValue['signIn'] = useCallback((input) => {
    const email = input.email.trim().toLowerCase();
    const user = db.users.find((u) => u.email === email);
    if (!user || user.password !== input.password) {
      return { ok: false, error: 'That email and password do not match an account.' };
    }
    setSessionId(user.id);
    return { ok: true };
  }, [db.users]);

  const signOut = useCallback(() => setSessionId(null), []);

  const createWish: StoreValue['createWish'] = useCallback((draft) => {
    const user = db.users.find((u) => u.id === sessionId);
    const wish: Wish = {
      id: makeId('wish'),
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category,
      helpType: draft.helpType,
      city: draft.city.trim() || null,
      requesterName: draft.requesterName.trim() || user?.name || 'Someone',
      ownerId: user?.id ?? 'unknown',
      isSample: false,
      status: 'open',
      offerCount: 0,
      createdAt: now(),
    };
    setDb((current) => ({ ...current, wishes: [wish, ...current.wishes] }));
    return wish;
  }, [db.users, sessionId]);

  const createOffer: StoreValue['createOffer'] = useCallback((wishId, draft) => {
    const user = db.users.find((u) => u.id === sessionId);
    if (!user) return { ok: false, error: 'Please sign in to offer help.' };
    const wish = db.wishes.find((w) => w.id === wishId);
    if (!wish) return { ok: false, error: 'This wish is no longer available.' };
    if (wish.isSample) return { ok: false, error: 'Example wishes cannot receive offers.' };
    if (wish.status !== 'open') return { ok: false, error: 'This wish is already in progress.' };
    if (wish.ownerId === user.id) return { ok: false, error: 'You cannot offer help on your own wish.' };
    const offer: Offer = {
      id: makeId('offer'),
      wishId,
      helperId: user.id,
      helperName: draft.helperName.trim() || user.name,
      helpType: draft.helpType,
      note: draft.note.trim(),
      status: 'pending',
      createdAt: now(),
    };
    setDb((current) => ({
      ...current,
      offers: [...current.offers, offer],
      wishes: current.wishes.map((w) => (w.id === wishId ? { ...w, offerCount: w.offerCount + 1 } : w)),
    }));
    return { ok: true, offer };
  }, [db.users, db.wishes, sessionId]);

  const acceptOffer: StoreValue['acceptOffer'] = useCallback((offerId) => {
    const user = db.users.find((u) => u.id === sessionId);
    if (!user) return null;
    const offer = db.offers.find((o) => o.id === offerId);
    const wish = offer && db.wishes.find((w) => w.id === offer.wishId);
    if (!offer || !wish || wish.ownerId !== user.id || wish.status !== 'open') return null;
    const conversation: Conversation = {
      id: makeId('conv'),
      wishId: wish.id,
      wishTitle: wish.title,
      ownerId: wish.ownerId,
      helperId: offer.helperId,
      createdAt: now(),
      updatedAt: now(),
    };
    setDb((current) => ({
      ...current,
      conversations: [conversation, ...current.conversations],
      offers: current.offers.map((o) =>
        o.wishId === wish.id ? { ...o, status: o.id === offerId ? 'accepted' : 'pending' } : o,
      ),
      wishes: current.wishes.map((w) => (w.id === wish.id ? { ...w, status: 'in_progress' } : w)),
    }));
    return conversation;
  }, [db.offers, db.users, db.wishes, sessionId]);

  const completeWish: StoreValue['completeWish'] = useCallback((wishId) => {
    const user = db.users.find((u) => u.id === sessionId);
    if (!user) return;
    const wish = db.wishes.find((w) => w.id === wishId);
    if (!wish || wish.ownerId !== user.id || wish.status !== 'in_progress') return;
    setDb((current) => ({
      ...current,
      wishes: current.wishes.map((w) => (w.id === wishId ? { ...w, status: 'completed' } : w)),
    }));
  }, [db.users, db.wishes, sessionId]);

  const sendMessage: StoreValue['sendMessage'] = useCallback((conversationId, body) => {
    const user = db.users.find((u) => u.id === sessionId);
    const clean = body.trim();
    if (!user || !clean) return;
    const conversation = db.conversations.find((c) => c.id === conversationId);
    if (!conversation || (conversation.ownerId !== user.id && conversation.helperId !== user.id)) return;
    const message: Message = { id: makeId('msg'), conversationId, senderId: user.id, body: clean, createdAt: now() };
    setDb((current) => ({
      ...current,
      messages: [...current.messages, message],
      conversations: current.conversations.map((c) =>
        c.id === conversationId ? { ...c, updatedAt: message.createdAt } : c,
      ),
    }));
  }, [db.conversations, db.users, sessionId]);

  const value = useMemo<StoreValue>(() => ({
    currentUser, signUp, signIn, signOut, userName,
    wishes: db.wishes, offers: db.offers, conversations: db.conversations, messages: db.messages,
    createWish, createOffer, acceptOffer, completeWish, sendMessage,
  }), [currentUser, signUp, signIn, signOut, userName, db.wishes, db.offers, db.conversations, db.messages, createWish, createOffer, acceptOffer, completeWish, sendMessage]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider is missing.');
  return value;
}

/* -------------------------------------------------------------------------- */
/*  Layout: header, footer, user menu                                         */
/* -------------------------------------------------------------------------- */

function UserMenu() {
  const { currentUser, signOut } = useStore();
  const [, setLocation] = useLocation();
  if (!currentUser) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/sign-in" className="auth-ghost-btn" data-testid="link-sign-in">Sign in</Link>
        <Link href="/sign-up" className="auth-solid-btn" data-testid="link-sign-up">Create account</Link>
      </div>
    );
  }
  const initial = currentUser.name.trim().charAt(0).toUpperCase() || 'U';
  const handleSignOut = () => { signOut(); setLocation('/'); };
  return (
    <div className="user-menu" data-testid="user-menu">
      <span className="user-avatar" aria-hidden="true">{initial}</span>
      <span className="user-name" data-testid="text-current-user">{currentUser.name}</span>
      <button type="button" className="user-signout" onClick={handleSignOut} data-testid="button-sign-out" aria-label="Sign out">
        <LogOut size={15} />
      </button>
    </div>
  );
}

function Header() {
  const [location] = useLocation();
  const { currentUser } = useStore();
  const active = (path: string) => location === path || (path === '/messages' && location.startsWith('/messages/'));
  return (
    <header className="topbar">
      <div className="page-wrap flex min-h-[74px] flex-wrap items-center justify-between gap-3 py-2">
        <Link href="/" className="inline-flex items-center gap-2.5 text-[#284b3b] no-underline" data-testid="link-brand"><span className="grid h-9 w-9 place-items-center rounded-[12px] bg-[#315642] text-[#f5f3e9]"><Leaf size={19} strokeWidth={1.8} /></span><span className="font-display text-[26px] font-semibold tracking-[-.04em]">wishwell</span></Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-6 text-[14px] font-medium text-[#5b6c62] md:flex">
          <Link href="/" className={`nav-link ${active('/') ? 'nav-current' : ''}`} data-testid="link-browse">Browse wishes</Link>
          <Link href="/safety" className={`nav-link ${active('/safety') ? 'nav-current' : ''}`} data-testid="link-safety">Safety</Link>
          {currentUser && <Link href="/account" className={`nav-link ${active('/account') ? 'nav-current' : ''}`} data-testid="link-account">My wishes</Link>}
          {currentUser && <Link href="/messages" className={`nav-link ${active('/messages') ? 'nav-current' : ''}`} data-testid="link-messages">Messages</Link>}
        </nav>
        <div className="flex items-center gap-3"><UserMenu /><Link href="/create" className="inline-flex h-10 items-center gap-2 rounded-full bg-[#315642] px-4 text-[13px] font-semibold text-white no-underline hover:bg-[#244534]" data-testid="link-create-wish"><Plus size={16} /><span className="hidden sm:inline">Post a wish</span></Link></div>
      </div>
      <nav aria-label="Mobile navigation" className="flex border-t border-[#e7e3d9] px-2 md:hidden"><Link href="/" className={`mobile-nav ${active('/') ? 'mobile-current' : ''}`} data-testid="mobile-link-browse"><Compass size={15} />Browse</Link><Link href="/safety" className={`mobile-nav ${active('/safety') ? 'mobile-current' : ''}`} data-testid="mobile-link-safety"><Shield size={15} />Safety</Link>{currentUser && <Link href="/account" className={`mobile-nav ${active('/account') ? 'mobile-current' : ''}`} data-testid="mobile-link-account"><Leaf size={15} />My wishes</Link>}{currentUser && <Link href="/messages" className={`mobile-nav ${active('/messages') ? 'mobile-current' : ''}`} data-testid="mobile-link-messages"><MessageCircle size={15} />Messages</Link>}</nav>
    </header>
  );
}

function Footer() {
  const { currentUser } = useStore();
  return <footer className="mt-20 border-t border-[#e5e1d7] bg-[#f0eee6]"><div className="page-wrap flex flex-col gap-5 py-8 text-sm text-[#637268] sm:flex-row sm:items-center sm:justify-between"><p className="m-0">A little help can make room for a lot.</p><div className="flex gap-6"><Link href="/" className="footer-link" data-testid="footer-link-browse">Browse wishes</Link><Link href="/safety" className="footer-link" data-testid="footer-link-safety">Safety guide</Link><Link href={currentUser ? '/account' : '/sign-in'} className="footer-link" data-testid="footer-link-account">{currentUser ? 'My account' : 'Sign in'}</Link></div></div></footer>;
}

function SummaryStrip() {
  const { wishes, offers } = useStore();
  const open = wishes.filter((wish) => wish.status === 'open').length;
  const values = [{ label: 'Open wishes', value: open, icon: Compass }, { label: 'Offers shared', value: offers.length, icon: HeartHandshake }, { label: 'Wishes with offers', value: wishes.filter((wish) => wish.offerCount > 0).length, icon: Sparkles }];
  return <section className="summary-strip" aria-label="Community totals">{values.map(({ label, value, icon: Icon }) => <div className="summary-cell" key={label} data-testid={`summary-${label.toLowerCase().replaceAll(' ', '-')}`}><span className="summary-icon"><Icon size={17} /></span><span className="summary-value">{value.toLocaleString()}</span><span className="summary-label">{label}</span></div>)}</section>;
}

function WishCard({ wish, index = 0 }: { wish: Wish; index?: number }) {
  return <Link href={`/wish/${wish.id}`} className="wish-card group block rounded-[18px] border border-[#e6e3da] bg-[#fffefa] p-5 text-inherit no-underline fade-up" style={{ animationDelay: `${index * 45}ms` }} data-testid={`card-wish-${wish.id}`}>
    <div className="mb-4 flex items-start justify-between gap-3"><span className={`category-pill mark-${wish.category.toLowerCase()}`}>{wish.category}</span>{wish.isSample ? <span className="example-label" data-testid={`label-example-${wish.id}`}>Example · read only</span> : wish.status === 'in_progress' ? <span className="status-chip status-progress" data-testid={`card-status-${wish.id}`}>In progress</span> : wish.status === 'completed' ? <span className="status-chip status-done" data-testid={`card-status-${wish.id}`}>Completed</span> : null}</div>
    <h3 className="font-display mb-2 text-[22px] font-semibold leading-[1.12] tracking-[-.025em] text-[#2e473b] group-hover:text-[#477359]" data-testid={`text-title-${wish.id}`}>{wish.title}</h3>
    <p className="mb-5 line-clamp-3 text-[14px] leading-[1.65] text-[#637068]" data-testid={`text-description-${wish.id}`}>{wish.description}</p>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#efede7] pt-4 text-[12px] text-[#68776e]"><span className="inline-flex items-center gap-1.5"><MapPin size={13} />{wish.city || 'Location not shared'}</span><span className="inline-flex items-center gap-1.5"><HeartHandshake size={14} />{wish.offerCount} {wish.offerCount === 1 ? 'offer' : 'offers'}</span><span className="ml-auto rounded-full bg-[#eef2eb] px-2.5 py-1 font-medium text-[#47644f]">{helpLabels[wish.helpType]}</span></div>
  </Link>;
}

/* -------------------------------------------------------------------------- */
/*  Browse                                                                    */
/* -------------------------------------------------------------------------- */

function BrowsePage() {
  const { wishes } = useStore(); const [searchText, setSearchText] = useState(''); const [category, setCategory] = useState(''); const [helpType, setHelpType] = useState('');
  const filteredWishes = wishes.filter((wish) => {
    const terms = `${wish.title} ${wish.description} ${wish.city ?? ''} ${wish.requesterName}`.toLowerCase();
    return (!searchText.trim() || terms.includes(searchText.trim().toLowerCase())) && (!category || wish.category === category) && (!helpType || wish.helpType === helpType);
  });
  const clearFilters = () => { setSearchText(''); setCategory(''); setHelpType(''); };
  const filtered = Boolean(searchText || category || helpType);
  return <main><section className="hero-surface"><div className="page-wrap relative z-10 grid min-h-[390px] items-center gap-8 py-14 md:grid-cols-[1.2fr_.8fr] md:py-16"><div className="max-w-[650px] fade-up"><p className="eyebrow"><span className="eyebrow-dot" />GOOD THINGS, SHARED</p><h1 className="font-display mb-5 mt-5 max-w-[700px] text-[clamp(42px,6vw,70px)] font-semibold leading-[.99] tracking-[-.052em] text-[#294839]">A wish is a place<br className="hidden sm:block" /> to begin.</h1><p className="mb-8 max-w-[490px] text-[17px] leading-[1.65] text-[#566e60]">Find a practical way to show up for someone — or make space for a need of your own.</p><div className="flex flex-wrap gap-3"><Link href="/create" className="inline-flex h-12 items-center gap-2 rounded-full bg-[#315642] px-6 text-sm font-semibold text-white no-underline" data-testid="hero-post-wish">Share a wish <ArrowRight size={16} /></Link><a href="#browse-wishes" className="inline-flex h-12 items-center gap-2 rounded-full border border-[#b9c9bc] px-6 text-sm font-semibold text-[#355443] no-underline hover:bg-white/60" data-testid="hero-browse-wishes">Explore wishes <ArrowDownRight size={16} /></a></div></div>
    <div className="hero-note soft-grid relative mx-auto hidden w-full max-w-[390px] rotate-[1.5deg] rounded-[24px] border border-[#d0dbcf] bg-[#f7f6ed] p-7 shadow-[0_22px_45px_rgba(46,76,59,.08)] md:block" aria-label="A note about community"><div className="mb-6 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#dfe9dc] text-[#43664d]"><HeartHandshake size={19} /></span><div><span className="block text-[12px] font-semibold uppercase tracking-[.12em] text-[#728075]">A shared place</span><span className="text-[14px] font-medium text-[#395744]">For practical kindness</span></div></div><p className="font-display text-[29px] leading-[1.18] tracking-[-.03em] text-[#365340]">“Small, specific help can change the shape of a day.”</p><div className="mt-6 flex items-center justify-between border-t border-[#dce2d7] pt-4 text-[12px] text-[#728075]"><span>Community-led, openly shared</span><Leaf size={15} /></div></div></div></section>
    <div className="page-wrap"><SummaryStrip /></div>
    <section className="page-wrap pb-4 pt-14" id="browse-wishes"><div className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="eyebrow mb-3">THE COMMUNITY BOARD</p><h2 className="font-display m-0 text-[38px] font-semibold leading-none tracking-[-.04em] text-[#294839]">Wishes, in the open</h2><p className="mb-0 mt-3 text-[14px] text-[#69786f]">Practical wishes shared by the community.</p></div><Link href="/create" className="inline-flex h-11 w-fit items-center gap-2 rounded-full border border-[#b9c9bc] px-5 text-[13px] font-semibold text-[#355443] no-underline hover:bg-[#eaf0e8]" data-testid="browse-create-link"><Plus size={16} />Post a wish</Link></div>
      <form onSubmit={(event) => event.preventDefault()} className="filter-panel mb-7" role="search" data-testid="form-wish-search"><div className="search-field"><Search size={17} aria-hidden="true" /><Input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search wishes or places" aria-label="Search wishes or places" data-testid="input-search-wishes" /></div><label className="select-wrap"><span className="sr-only">Filter by category</span><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category" data-testid="select-category"><option value="">All categories</option>{categories.map((item) => <option value={item} key={item}>{item}</option>)}</select><ChevronDown size={15} /></label><label className="select-wrap"><span className="sr-only">Filter by kind of help</span><select value={helpType} onChange={(event) => setHelpType(event.target.value)} aria-label="Filter by kind of help" data-testid="select-help-type"><option value="">Any kind of help</option>{helpTypes.map((item) => <option value={item} key={item}>{helpLabels[item]}</option>)}</select><ChevronDown size={15} /></label><Button type="button" className="h-11 rounded-full px-5" onClick={() => undefined} data-testid="button-search-wishes">Search</Button>{filtered && <button type="button" className="clear-filter" onClick={clearFilters} data-testid="button-clear-filters">Clear</button>}</form>
      {filteredWishes.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredWishes.map((wish, index) => <WishCard key={wish.id} wish={wish} index={index} />)}</div> : <div className="state-panel" data-testid="status-wishes-empty"><span className="state-icon"><Search size={21} /></span><h3>{filtered ? 'No wishes match those filters.' : 'The board is quiet for now.'}</h3><p>{filtered ? 'Try another search or clear the filters to see all wishes.' : 'A thoughtful first wish could be yours.'}</p><div className="flex flex-wrap justify-center gap-3">{filtered && <Button variant="outline" onClick={clearFilters} data-testid="button-empty-clear-filters">Clear filters</Button>}<Link href="/create" className="inline-flex h-10 items-center rounded-full bg-[#315642] px-5 text-sm font-semibold text-white no-underline" data-testid="empty-create-wish">Post a wish</Link></div></div>}
    </section>
    <section className="page-wrap py-14"><div className="small-trust-banner"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#dfe9dc] text-[#45694f]"><ShieldCheck size={21} /></div><div><p className="mb-1 font-semibold text-[#365340]">Private spaces where they matter.</p><p className="m-0 text-[13px] leading-relaxed text-[#66766b]">Offer notes are visible only to the wish owner. Messages are visible only to the two people in a conversation. Read the <Link href="/safety" className="font-semibold text-[#315642] underline underline-offset-2" data-testid="inline-safety-link">safety guide</Link>.</p></div></div></section>
  </main>;
}

/* -------------------------------------------------------------------------- */
/*  Create wish (auth required)                                               */
/* -------------------------------------------------------------------------- */

const wishSchema = z.object({
  title: z.string().min(5, 'Use at least 5 characters.').max(100, 'Keep the title under 100 characters.'),
  description: z.string().min(20, 'Add a little more detail (at least 20 characters).').max(1200, 'Keep the description under 1,200 characters.'),
  category: z.enum(['Education', 'Health', 'Technology', 'Community', 'Creative', 'Other']),
  helpType: z.enum(['funding', 'goods', 'time', 'skills', 'other']),
  city: z.string().max(80, 'Keep the location under 80 characters.').default(''),
  requesterName: z.string().min(2, 'Please enter at least 2 characters.').max(50, 'Keep the name under 50 characters.'),
});
type WishFormValues = z.infer<typeof wishSchema>;

function CreatePage() {
  const { createWish, currentUser } = useStore(); const [, setLocation] = useLocation();
  const form = useForm<WishFormValues>({ resolver: zodResolver(wishSchema), defaultValues: { title: '', description: '', category: 'Community', helpType: 'goods', city: '', requesterName: currentUser?.name ?? '' } });
  const [createdTitle, setCreatedTitle] = useState('');
  const submit = (values: WishFormValues) => { const wish = createWish(values); setCreatedTitle(wish.title); setLocation(`/wish/${wish.id}`); };
  return <main className="page-wrap py-9 md:py-14"><Link href="/" className="back-link" data-testid="link-back-browse"><ArrowLeft size={15} />Back to wishes</Link><div className="form-layout mt-8">
    <section className="form-intro"><p className="eyebrow mb-4">MAKE ROOM FOR HELP</p><h1 className="font-display mb-5 text-[46px] font-semibold leading-[1.03] tracking-[-.045em] text-[#294839]">What would help<br className="hidden sm:block" /> right now?</h1><p className="max-w-[390px] text-[15px] leading-[1.7] text-[#627368]">A clear, practical wish gives people a real way to show up.</p><div className="mt-8 rounded-2xl border border-[#dce3d9] bg-[#edf1e9] p-5"><div className="mb-3 flex items-center gap-2 text-[#375744]"><LockKeyhole size={16} /><span className="text-[13px] font-semibold">A few things to know</span></div><ul className="mb-0 space-y-2 pl-4 text-[13px] leading-relaxed text-[#66766b]"><li>Your wish and chosen name appear publicly.</li><li>Offer notes are private to the wish owner.</li><li>Your data is stored locally in this browser.</li></ul></div></section>
    <section className="form-card" aria-labelledby="create-heading"><div className="mb-6"><h2 id="create-heading" className="font-display m-0 text-[27px] font-semibold tracking-[-.025em] text-[#304c3d]">Your wish</h2><p className="mb-0 mt-1 text-[13px] text-[#718077]">Posting as {currentUser?.name}</p></div>
      {createdTitle && <div className="success-message mb-4" role="status" data-testid="status-create-success"><Check size={17} /><span>“{createdTitle}” was posted.</span></div>}
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-create-wish">
        <FormField control={form.control} name="title" render={({ field }) => <FormItem><FormLabel>Wish title <span className="text-[#a45f49]">*</span></FormLabel><FormControl><Input placeholder="A simple, specific headline" maxLength={100} {...field} data-testid="input-wish-title" /></FormControl><FormMessage /><p className="field-hint">For example: “A used laptop for my evening classes”</p></FormItem>} />
        <FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel>What would help? <span className="text-[#a45f49]">*</span></FormLabel><FormControl><Textarea placeholder="Share what you need and a little context. Avoid including private details like an address or account information." maxLength={1200} rows={5} {...field} data-testid="input-wish-description" /></FormControl><FormMessage /><p className="field-hint">{field.value?.length ?? 0} / 1,200 characters</p></FormItem>} />
        <div className="grid gap-5 sm:grid-cols-2"><FormField control={form.control} name="category" render={({ field }) => <FormItem><FormLabel>Category *</FormLabel><FormControl><select className="form-select" {...field} data-testid="select-wish-category">{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></FormControl><p className="field-hint">{categoryNotes[field.value]}</p><FormMessage /></FormItem>} /><FormField control={form.control} name="helpType" render={({ field }) => <FormItem><FormLabel>Kind of help *</FormLabel><FormControl><select className="form-select" {...field} data-testid="select-wish-help-type">{helpTypes.map((item) => <option key={item} value={item}>{helpLabels[item]}</option>)}</select></FormControl><p className="field-hint">Choose the kind of support that fits best.</p><FormMessage /></FormItem>} /></div>
        <div className="grid gap-5 sm:grid-cols-2"><FormField control={form.control} name="requesterName" render={({ field }) => <FormItem><FormLabel>Your name *</FormLabel><FormControl><Input placeholder="How you’d like to be known" maxLength={50} {...field} data-testid="input-requester-name" /></FormControl><FormMessage /><p className="field-hint">Shown publicly on your wish.</p></FormItem>} /><FormField control={form.control} name="city" render={({ field }) => <FormItem><FormLabel>City or area <span className="font-normal text-[#839087]">(optional)</span></FormLabel><FormControl><Input placeholder="e.g. Portland" maxLength={80} {...field} data-testid="input-requester-city" /></FormControl><FormMessage /><p className="field-hint">Keep it broad. No street addresses, please.</p></FormItem>} /></div>
        <div className="border-t border-[#ebe8df] pt-5"><Button type="submit" className="h-12 w-full rounded-full text-[14px]" data-testid="button-submit-wish">Post wish <ArrowRight size={16} className="ml-2" /></Button></div>
      </form></Form>
    </section>
  </div></main>;
}

/* -------------------------------------------------------------------------- */
/*  Wish detail + offers (auth required to offer / accept)                    */
/* -------------------------------------------------------------------------- */

const offerSchema = z.object({ helperName: z.string().min(2, 'Please enter at least 2 characters.').max(50, 'Keep the name under 50 characters.'), helpType: z.enum(['funding', 'goods', 'time', 'skills', 'other']), note: z.string().min(10, 'Please add at least 10 characters so your offer is clear.').max(500, 'Keep the note under 500 characters.') });
type OfferFormValues = z.infer<typeof offerSchema>;

function WishPage() {
  const params = useParams<{ id: string }>(); const id = params.id;
  const { wishes, offers, currentUser, createOffer, acceptOffer, completeWish } = useStore(); const [, setLocation] = useLocation();
  const wish = wishes.find((item) => item.id === id);
  const isOwner = Boolean(wish && currentUser && wish.ownerId === currentUser.id);
  const form = useForm<OfferFormValues>({ resolver: zodResolver(offerSchema), defaultValues: { helperName: currentUser?.name ?? '', helpType: 'goods', note: '' } });
  const [sent, setSent] = useState(false); const [offerError, setOfferError] = useState('');
  if (!wish) return <main className="page-wrap py-20"><StatePanel icon={CircleHelp} title="This wish isn’t available." body="It may have been removed." testId="status-wish-error"><Link href="/" className="mt-3 inline-flex items-center gap-2 font-semibold text-[#315642]" data-testid="link-back-to-board">Back to the board <ArrowRight size={15} /></Link></StatePanel></main>;
  const submitOffer = (values: OfferFormValues) => { const result = createOffer(id, values); if (!result.ok) { setOfferError(result.error); return; } setOfferError(''); setSent(true); form.reset({ helperName: currentUser?.name ?? '', helpType: 'goods', note: '' }); };
  const handleAccept = (offerId: string) => { const conversation = acceptOffer(offerId); if (conversation) setLocation(`/messages/${conversation.id}`); };
  const wishOffers = offers.filter((offer) => offer.wishId === id);
  const canOffer = Boolean(currentUser) && !isOwner && !wish.isSample && wish.status === 'open';
  return <main className="page-wrap pb-10 pt-8 md:pt-12"><Link href="/" className="back-link" data-testid="link-back-browse"><ArrowLeft size={15} />All wishes</Link>
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_370px]"><section>
      <div className="mb-6 flex flex-wrap items-center gap-2"><span className={`category-pill mark-${wish.category.toLowerCase()}`} data-testid={`text-category-${wish.id}`}>{wish.category}</span><span className="help-chip" data-testid={`text-help-type-${wish.id}`}>{helpLabels[wish.helpType]}</span>{wish.isSample && <span className="example-label" data-testid={`label-example-${wish.id}`}>Example wish · read only</span>}{!wish.isSample && wish.status === 'in_progress' && <span className="status-chip status-progress" data-testid={`status-chip-${wish.id}`}>In progress</span>}{!wish.isSample && wish.status === 'completed' && <span className="status-chip status-done" data-testid={`status-chip-${wish.id}`}>Completed</span>}</div>
      <h1 className="font-display mb-5 max-w-[800px] text-[clamp(38px,5vw,60px)] font-semibold leading-[1.02] tracking-[-.045em] text-[#294839]" data-testid={`text-wish-title-${wish.id}`}>{wish.title}</h1>
      <div className="mb-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[#6d7a71]"><span>Shared by <strong className="font-semibold text-[#41584a]" data-testid={`text-requester-${wish.id}`}>{wish.requesterName}</strong></span>{wish.city && <span className="inline-flex items-center gap-1"><MapPin size={14} />{wish.city}</span>}<span>{new Date(wish.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
      <article className="wish-description" data-testid={`text-wish-description-${wish.id}`}><p>{wish.description}</p></article>
      <div className="public-note mt-5"><LockKeyhole size={16} /><p><strong>Private offers.</strong> Offer notes are never displayed on the public board. The owner can review them here; an accepted offer opens a private conversation.</p></div>
      {isOwner && <section className="mt-10" aria-labelledby="offers-heading"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow mb-2">OWNER VIEW · PRIVATE</p><h2 id="offers-heading" className="font-display m-0 text-[30px] font-semibold tracking-[-.035em] text-[#304c3d]">Offers to consider</h2></div><div className="flex items-center gap-3"><span className="offer-count" data-testid={`text-offer-count-${wish.id}`}>{wish.offerCount} {wish.offerCount === 1 ? 'offer' : 'offers'}</span>{wish.status === 'in_progress' && <Button type="button" size="sm" variant="outline" onClick={() => completeWish(wish.id)} data-testid={`button-complete-wish-${wish.id}`}>Mark as complete</Button>}{wish.status === 'completed' && <span className="rounded-full bg-[#edf4ea] px-3 py-1.5 text-xs font-semibold text-[#426547]" data-testid={`status-wish-completed-${wish.id}`}>Completed</span>}</div></div>
        {wishOffers.length ? <div className="space-y-3">{wishOffers.map((offer) => <article className="offer-card" key={offer.id} data-testid={`card-offer-${offer.id}`}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="offer-avatar" aria-hidden="true">{offer.helperName.trim().charAt(0).toUpperCase()}</span><span className="font-semibold text-[#3b5546]" data-testid={`text-offer-helper-${offer.id}`}>{offer.helperName}</span></div><span className="help-chip">{helpLabels[offer.helpType]}</span></div><p className="mb-3 text-[14px] leading-[1.65] text-[#56675c]" data-testid={`text-offer-note-${offer.id}`}>{offer.note}</p><div className="flex items-center justify-between gap-3"><time className="text-[11px] text-[#8a948c]" dateTime={offer.createdAt}>{new Date(offer.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>{offer.status === 'accepted' ? <span className="rounded-full bg-[#edf4ea] px-3 py-1.5 text-xs font-semibold text-[#426547]" data-testid={`status-offer-accepted-${offer.id}`}>Accepted · conversation open</span> : wish.status === 'open' ? <Button type="button" size="sm" onClick={() => handleAccept(offer.id)} data-testid={`button-accept-offer-${offer.id}`}>Accept offer</Button> : <span className="text-xs text-[#7a887e]">Wish in progress</span>}</div></article>)}</div> : <div className="offers-empty" data-testid="status-offers-empty"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#e7eee5] text-[#4c6d53]"><HeartHandshake size={19} /></span><div><p className="mb-1 font-semibold text-[#405b49]">No offers yet</p><p className="m-0 text-[13px] leading-relaxed text-[#718077]">When someone offers to help, their private note appears here.</p></div></div>}
      </section>}
    </section>
    {!isOwner && <aside className="offer-form-card lg:sticky lg:top-[100px]"><div className="mb-5 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-[#e4ede2] text-[#42664c]"><HeartHandshake size={21} /></span><div><p className="eyebrow mb-1">SHOW UP IN A WAY THAT FITS</p><h2 className="font-display m-0 text-[24px] font-semibold tracking-[-.03em] text-[#304c3d]">Offer to help</h2></div></div>
      {wish.isSample ? <div className="state-panel !min-h-[180px]" data-testid="status-sample-not-actionable"><span className="state-icon"><CircleHelp size={21} /></span><h3>Example wish</h3><p>This sample helps explain the board. Offers are disabled for examples.</p></div> : wish.status === 'completed' ? <div className="state-panel !min-h-[180px]" data-testid="status-wish-completed"><span className="state-icon"><Check size={20} /></span><h3>Wish completed</h3><p>The owner has marked this wish as complete.</p></div> : wish.status !== 'open' ? <div className="state-panel !min-h-[180px]" data-testid="status-wish-in-progress"><span className="state-icon"><Check size={20} /></span><h3>Offer accepted</h3><p>This wish is already in progress.</p></div> : !currentUser ? <div className="state-panel !min-h-[180px]" data-testid="status-offer-requires-auth"><span className="state-icon"><LockKeyhole size={20} /></span><h3>Sign in to offer help</h3><p>Create a free account or sign in to send a private offer.</p><Link href="/sign-in" className="inline-flex h-10 items-center gap-2 rounded-full bg-[#315642] px-5 text-sm font-semibold text-white no-underline" data-testid="link-offer-sign-in">Sign in <ArrowRight size={15} /></Link></div> : <><p className="mb-5 text-[13px] leading-relaxed text-[#69776e]">Your note is private to the wish owner. If they accept, you can continue in a private conversation.</p>{sent && <div className="success-message mb-4" role="status" data-testid="status-offer-success"><Check size={17} /><span>Your private offer was sent.</span></div>}
        <Form {...form}><form onSubmit={form.handleSubmit(submitOffer)} className="space-y-4" data-testid="form-create-offer">
          <FormField control={form.control} name="helperName" render={({ field }) => <FormItem><FormLabel>Your name</FormLabel><FormControl><Input placeholder="How you’d like to be known" maxLength={50} {...field} data-testid="input-helper-name" /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="helpType" render={({ field }) => <FormItem><FormLabel>Kind of help</FormLabel><FormControl><select className="form-select" {...field} data-testid="select-offer-help-type">{helpTypes.map((item) => <option key={item} value={item}>{helpLabels[item]}</option>)}</select></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="note" render={({ field }) => <FormItem><FormLabel>Your offer</FormLabel><FormControl><Textarea placeholder="Say what you can offer and a safe next step. Don’t include phone numbers, addresses, or financial details." maxLength={500} rows={4} {...field} data-testid="input-offer-note" /></FormControl><FormMessage /><p className="field-hint">{field.value?.length ?? 0} / 500</p></FormItem>} />
          {offerError && <div className="form-error" role="alert" data-testid="status-offer-error">{offerError}</div>}
          <Button type="submit" className="h-11 w-full rounded-full" disabled={!canOffer} data-testid="button-submit-offer">Send private offer <ArrowRight size={15} className="ml-2" /></Button><p className="mb-0 text-center text-[11px] leading-relaxed text-[#838d85]">No money moves through Wishwell.</p>
        </form></Form></>}
    </aside>}
    {isOwner && wish.isSample && <aside className="offer-form-card" data-testid="status-sample-owner-note"><p className="m-0 text-sm text-[#718077]">This example is non-actionable, including in the owner view.</p></aside>}
    </div>
  </main>;
}

/* -------------------------------------------------------------------------- */
/*  Safety                                                                    */
/* -------------------------------------------------------------------------- */

function SafetyPage() {
  const guidance: { icon: LucideIcon; title: string; body: string; list: string[] }[] = [
    { icon: UsersRound, title: 'For people sharing a wish', body: 'You choose what to share. A public post can be read by anyone, so keep your boundaries close.', list: ['Use a first name or the name you are comfortable sharing.', 'Describe the need without an exact address, phone number, account details, or private documents.', 'You can decline an offer that does not feel right. You do not owe anyone personal information.'] },
    { icon: HeartHandshake, title: 'For people offering help', body: 'A thoughtful offer is specific, realistic, and respectful. Your note is private to the wish owner.', list: ['Say what you can offer plainly, without promises you cannot keep.', 'Keep your note free of payment details, phone numbers, and personal contact information.', 'Never pressure someone to share more, meet, or accept your offer.'] },
  ];
  return <main><section className="safety-hero"><div className="page-wrap py-14 md:py-20"><div className="safety-kicker"><ShieldCheck size={16} />A CLEAR-EYED GUIDE</div><h1 className="font-display mt-5 max-w-[720px] text-[clamp(40px,6vw,68px)] font-semibold leading-[1.02] tracking-[-.05em] text-[#294839]">Kindness works best<br className="hidden sm:block" /> with good boundaries.</h1><p className="mb-0 mt-5 max-w-[590px] text-[17px] leading-[1.7] text-[#5f7266]">Wishwell is a public community board with private offer notes and conversations. It does not verify identities or move money.</p></div></section>
    <div className="page-wrap"><section className="safety-reality" aria-labelledby="reality-heading"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#f2e7dd] text-[#9c634b]"><CircleHelp size={22} /></div><div><p className="eyebrow mb-2">GOOD TO KNOW</p><h2 id="reality-heading" className="font-display mb-3 text-[27px] font-semibold tracking-[-.03em] text-[#304c3d]">Useful connection, not a safety guarantee.</h2><p className="mb-3 text-[14px] leading-[1.7] text-[#64736a]">Wishwell does not independently verify identities or process payments. Public wish details are distinct from owner-only offer notes and participant-only conversation messages.</p><p className="m-0 text-[13px] font-medium text-[#8d5d49]">Never share passwords, one-time codes, financial credentials, or urgent private information.</p></div></section>
      <section className="grid gap-5 py-10 md:grid-cols-2" aria-label="Safety guidance">{guidance.map(({ icon: Icon, title, body, list }) => <article className="guidance-card" key={title}><div className="mb-5 grid h-11 w-11 place-items-center rounded-full bg-[#e6eee4] text-[#42644b]"><Icon size={20} /></div><h2 className="font-display mb-2 text-[26px] font-semibold tracking-[-.03em] text-[#304c3d]">{title}</h2><p className="mb-5 text-[14px] leading-[1.65] text-[#6a786f]">{body}</p><ul className="safety-list">{list.map((line) => <li key={line}>{line}</li>)}</ul></article>)}</section>
      <section className="next-steps"><div><p className="eyebrow mb-2">KEEP IT PRACTICAL</p><h2 className="font-display m-0 text-[30px] font-semibold tracking-[-.035em] text-[#304c3d]">A few good habits go a long way.</h2></div><div className="next-steps-copy"><p>When connecting outside Wishwell, choose a public place if meeting in person, tell someone you trust, and do not share financial or identity documents. If a situation feels uncomfortable, step away. You are allowed to say no.</p><Link href="/" className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#315642] no-underline hover:underline" data-testid="link-safety-browse">Back to the community board <ArrowRight size={15} /></Link></div></section>
    </div></main>;
}

/* -------------------------------------------------------------------------- */
/*  Account (auth required)                                                   */
/* -------------------------------------------------------------------------- */

function AccountPage() {
  const { wishes, currentUser } = useStore();
  const mine = wishes.filter((wish) => currentUser && wish.ownerId === currentUser.id);
  return <main className="page-wrap py-10 md:py-14"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow mb-3">YOUR COMMUNITY CORNER</p><h1 className="font-display m-0 text-[clamp(36px,5vw,54px)] font-semibold leading-none tracking-[-.045em] text-[#294839]">My wishes</h1><p className="mb-0 mt-3 text-sm text-[#69786f]">Signed in as {currentUser?.name} · {currentUser?.email}</p></div><Link href="/create" className="inline-flex h-11 items-center gap-2 rounded-full bg-[#315642] px-5 text-sm font-semibold text-white no-underline" data-testid="account-create-wish"><Plus size={16} />Post a wish</Link></div>
    {mine.length ? <div className="grid gap-4 md:grid-cols-2">{mine.map((wish, index) => <WishCard key={wish.id} wish={wish} index={index} />)}</div> : <StatePanel icon={Leaf} title="No wishes shared yet." body="Post your first wish to let the community know how they can help." testId="status-account-wishes-empty"><Link href="/create" className="inline-flex h-10 items-center rounded-full bg-[#315642] px-5 text-sm font-semibold text-white no-underline" data-testid="account-empty-create">Share a wish</Link></StatePanel>}
  </main>;
}

/* -------------------------------------------------------------------------- */
/*  Messages (auth required)                                                  */
/* -------------------------------------------------------------------------- */

function MessagesPage() {
  const { conversations, currentUser } = useStore();
  const mine = conversations.filter((c) => currentUser && (c.ownerId === currentUser.id || c.helperId === currentUser.id));
  return <main className="page-wrap py-10 md:py-14"><div className="mb-8"><p className="eyebrow mb-3">AFTER AN ACCEPTED OFFER</p><h1 className="font-display m-0 text-[clamp(36px,5vw,54px)] font-semibold leading-none tracking-[-.045em] text-[#294839]">Messages</h1><p className="mb-0 mt-3 text-sm text-[#69786f]">Private conversations between a wish owner and an accepted supporter.</p></div>
    {mine.length ? <div className="conversation-list">{mine.map((conversation) => <ConversationLink conversation={conversation} key={conversation.id} />)}</div> : <StatePanel icon={MessageCircle} title="No conversations yet." body="When you accept an offer on one of your wishes, a private conversation opens here." testId="status-conversations-empty"><Link href="/" className="inline-flex h-10 items-center gap-2 rounded-full border border-[#bdcabe] px-5 text-sm font-semibold text-[#355443] no-underline" data-testid="messages-browse">Browse wishes <ArrowRight size={15} /></Link></StatePanel>}
  </main>;
}

function ConversationLink({ conversation }: { conversation: Conversation }) {
  const { currentUser, userName } = useStore();
  const otherId = currentUser && currentUser.id === conversation.ownerId ? conversation.helperId : conversation.ownerId;
  const otherName = userName(otherId);
  return <Link href={`/messages/${conversation.id}`} className="conversation-row" data-testid={`card-conversation-${conversation.id}`}><span className="conversation-icon"><MessageCircle size={19} /></span><span className="min-w-0 flex-1"><strong className="block truncate text-[#365340]" data-testid={`text-conversation-title-${conversation.id}`}>{conversation.wishTitle}</strong><span className="mt-1 block text-xs text-[#758178]">With {otherName} · Updated {new Date(conversation.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></span><ArrowRight size={17} className="shrink-0 text-[#77907c]" /></Link>;
}

function ConversationPage() {
  const params = useParams<{ id: string }>(); const conversationId = params.id;
  const { conversations, messages, currentUser, userName, sendMessage } = useStore();
  const conversation = conversations.find((item) => item.id === conversationId);
  const [body, setBody] = useState(''); const [error, setError] = useState('');
  const isParticipant = Boolean(conversation && currentUser && (conversation.ownerId === currentUser.id || conversation.helperId === currentUser.id));
  if (!conversation || !isParticipant) return <main className="page-wrap py-16"><StatePanel icon={LockKeyhole} title="This conversation is private." body="Only the two people in this conversation can view it." testId="status-conversation-private"><Link href="/messages" className="font-semibold text-[#315642]" data-testid="link-back-messages">Back to messages</Link></StatePanel></main>;
  const thread = messages.filter((message) => message.conversationId === conversationId);
  const handleSend = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!body.trim()) { setError('Write a message before sending.'); return; } sendMessage(conversationId, body); setBody(''); setError(''); };
  return <main className="page-wrap conversation-page py-8 md:py-12"><Link href="/messages" className="back-link" data-testid="link-back-messages"><ArrowLeft size={15} />All messages</Link>
    <section className="conversation-panel mt-6" aria-label="Private conversation"><header className="conversation-heading"><span className="conversation-icon"><MessageCircle size={19} /></span><div className="min-w-0"><p className="eyebrow mb-1">PRIVATE CONVERSATION</p><h1 className="font-display m-0 truncate text-[25px] font-semibold tracking-[-.025em] text-[#304c3d]" data-testid={`text-active-conversation-title-${conversationId}`}>{conversation.wishTitle}</h1><p className="mb-0 mt-1 text-xs text-[#728075]">Visible only to the two participants.</p></div><span className="live-pill" data-testid="status-conversation-local"><span />Saved locally</span></header>
      <div className="message-stream" role="log" aria-live="polite" data-testid="list-messages">{thread.length ? thread.map((message) => { const mine = Boolean(currentUser && message.senderId === currentUser.id); return <article key={message.id} className={`message-bubble ${mine ? 'message-mine' : 'message-theirs'}`} data-testid={`message-${message.id}`}><p data-testid={`text-message-body-${message.id}`}>{message.body}</p><time dateTime={message.createdAt} data-testid={`text-message-date-${message.id}`}>{new Date(message.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{mine ? ' · you' : ` · ${userName(message.senderId)}`}</time></article>; }) : <div className="message-empty" data-testid="status-messages-empty"><span className="state-icon"><MessageCircle size={19} /></span><p className="mb-1 mt-3 font-semibold text-[#405b49]">A good place to start.</p><p className="m-0 text-sm text-[#718077]">Send a note to begin the conversation.</p></div>}</div>
      <form onSubmit={handleSend} className="message-composer" data-testid="form-send-message"><label className="sr-only" htmlFor="message-body">Write a message</label><Textarea id="message-body" value={body} onChange={(event) => { setBody(event.target.value); setError(''); }} maxLength={2000} rows={2} placeholder="Write a thoughtful reply…" data-testid="input-message-body" /><div className="composer-bottom"><span className="text-[11px] text-[#849087]">{body.length} / 2,000</span><Button type="submit" disabled={!body.trim()} className="h-10 rounded-full px-5" data-testid="button-send-message">Send<Send size={14} className="ml-2" /></Button></div>{error && <p className="form-error m-0" role="alert" data-testid="status-send-message-error">{error}</p>}</form>
    </section>
  </main>;
}

/* -------------------------------------------------------------------------- */
/*  Auth pages                                                                */
/* -------------------------------------------------------------------------- */

const signInSchema = z.object({
  email: z.string().min(1, 'Enter your email.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type SignInValues = z.infer<typeof signInSchema>;

function SignInPage() {
  const { signIn, currentUser } = useStore(); const [, setLocation] = useLocation();
  const form = useForm<SignInValues>({ resolver: zodResolver(signInSchema), defaultValues: { email: '', password: '' } });
  const [error, setError] = useState('');
  if (currentUser) return <Redirect to="/account" />;
  const submit = (values: SignInValues) => { const result = signIn(values); if (!result.ok) { setError(result.error); return; } setError(''); setLocation('/account'); };
  return <main className="page-wrap py-12 md:py-20"><div className="auth-panel"><p className="eyebrow">WELCOME BACK</p><h1 className="font-display mb-3 mt-3 text-[clamp(34px,5vw,48px)] font-semibold leading-none tracking-[-.045em] text-[#294839]" data-testid="text-sign-in-heading">Sign in to Wishwell.</h1><p className="mb-7 max-w-[440px] text-sm leading-relaxed text-[#68776e]">Use the email and password you created your account with.</p>
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="auth-form space-y-4" data-testid="form-sign-in">
      <FormField control={form.control} name="email" render={({ field }) => <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" autoComplete="email" placeholder="you@example.com" {...field} data-testid="input-sign-in-email" /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="password" render={({ field }) => <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" autoComplete="current-password" placeholder="••••••••" {...field} data-testid="input-sign-in-password" /></FormControl><FormMessage /></FormItem>} />
      {error && <div className="form-error" role="alert" data-testid="status-sign-in-error">{error}</div>}
      <Button type="submit" className="h-12 w-full rounded-full text-[14px]" data-testid="button-sign-in">Sign in <ArrowRight size={16} className="ml-2" /></Button>
    </form></Form>
    <p className="mt-6 text-sm text-[#68776e]">New to Wishwell? <Link href="/sign-up" className="font-semibold text-[#315642] underline underline-offset-2" data-testid="link-to-sign-up">Create an account</Link></p>
  </div></main>;
}

const signUpSchema = z.object({
  name: z.string().min(2, 'Please enter at least 2 characters.').max(50, 'Keep the name under 50 characters.'),
  email: z.string().min(1, 'Enter your email.').email('Enter a valid email address.'),
  password: z.string().min(6, 'Use at least 6 characters.').max(100, 'Keep the password under 100 characters.'),
});
type SignUpValues = z.infer<typeof signUpSchema>;

function SignUpPage() {
  const { signUp, currentUser } = useStore(); const [, setLocation] = useLocation();
  const form = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema), defaultValues: { name: '', email: '', password: '' } });
  const [error, setError] = useState('');
  if (currentUser) return <Redirect to="/account" />;
  const submit = (values: SignUpValues) => { const result = signUp(values); if (!result.ok) { setError(result.error); return; } setError(''); setLocation('/account'); };
  return <main className="page-wrap py-12 md:py-20"><div className="auth-panel"><p className="eyebrow">JOIN THE COMMUNITY</p><h1 className="font-display mb-3 mt-3 text-[clamp(34px,5vw,48px)] font-semibold leading-none tracking-[-.045em] text-[#294839]" data-testid="text-sign-up-heading">Create your account.</h1><p className="mb-7 max-w-[440px] text-sm leading-relaxed text-[#68776e]">Your account and posts are stored locally in this browser. No email verification needed.</p>
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="auth-form space-y-4" data-testid="form-sign-up">
      <FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Your name</FormLabel><FormControl><Input autoComplete="name" placeholder="How you’d like to be known" maxLength={50} {...field} data-testid="input-sign-up-name" /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="email" render={({ field }) => <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" autoComplete="email" placeholder="you@example.com" {...field} data-testid="input-sign-up-email" /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="password" render={({ field }) => <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" autoComplete="new-password" placeholder="At least 6 characters" {...field} data-testid="input-sign-up-password" /></FormControl><FormMessage /><p className="field-hint">Stored locally in your browser only. Don’t reuse a sensitive password.</p></FormItem>} />
      {error && <div className="form-error" role="alert" data-testid="status-sign-up-error">{error}</div>}
      <Button type="submit" className="h-12 w-full rounded-full text-[14px]" data-testid="button-sign-up">Create account <ArrowRight size={16} className="ml-2" /></Button>
    </form></Form>
    <p className="mt-6 text-sm text-[#68776e]">Already have an account? <Link href="/sign-in" className="font-semibold text-[#315642] underline underline-offset-2" data-testid="link-to-sign-in">Sign in</Link></p>
  </div></main>;
}

/* -------------------------------------------------------------------------- */
/*  Shared bits + routing                                                     */
/* -------------------------------------------------------------------------- */

function StatePanel({ icon: Icon, title, body, testId, children }: { icon: LucideIcon; title: string; body: string; testId: string; children?: ReactNode }) {
  return <div className="state-panel" data-testid={testId}><span className="state-icon"><Icon size={22} /></span><h3>{title}</h3><p>{body}</p>{children}</div>;
}

function NotFound() {
  return <main className="page-wrap py-24 text-center"><span className="state-icon mx-auto"><Compass size={22} /></span><p className="eyebrow mt-6">WRONG TURN</p><h1 className="font-display text-4xl text-[#294839]">That page isn’t here.</h1><Link href="/" className="mt-3 inline-flex items-center gap-2 font-semibold text-[#315642]" data-testid="link-not-found-home">Return to wishes <ArrowRight size={15} /></Link></main>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { currentUser } = useStore();
  if (!currentUser) return <Redirect to="/sign-in" />;
  return <>{children}</>;
}

function AppRoutes() {
  const [location] = useLocation();
  const noFrame = location.startsWith('/sign-in') || location.startsWith('/sign-up');
  return <div className="site-shell">{!noFrame && <Header />}<Switch>
    <Route path="/sign-in" component={SignInPage} />
    <Route path="/sign-up" component={SignUpPage} />
    <Route path="/" component={BrowsePage} />
    <Route path="/safety" component={SafetyPage} />
    <Route path="/create">{() => <RequireAuth><CreatePage /></RequireAuth>}</Route>
    <Route path="/wish/:id" component={WishPage} />
    <Route path="/account">{() => <RequireAuth><AccountPage /></RequireAuth>}</Route>
    <Route path="/messages">{() => <RequireAuth><MessagesPage /></RequireAuth>}</Route>
    <Route path="/messages/:id">{() => <RequireAuth><ConversationPage /></RequireAuth>}</Route>
    <Route component={NotFound} />
  </Switch>{!noFrame && <Footer />}</div>;
}

function App() {
  return <StoreProvider><AppRoutes /></StoreProvider>;
}

export default App;
