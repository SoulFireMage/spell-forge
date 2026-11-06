// cloud.js — Skapi: optional accounts, a private Spellbook and the public
// Hall of Sigils. Nothing here is required for the forge to work.
//
// Privacy: Skapi isn't contacted at all until you sign in, or until a
// browser where you signed in before comes back. The SDK
// is loaded from jsDelivr only then.
//
// The project is shared with Starship Whisperer (the owner's choice), so
// every table is prefixed `spellforge_` and one login works on both sites.
import { encodeGenome, decodeGenome, hashGenome } from './genome.js?v=1.1.0';

// Public configuration. The project ID identifies the project; it isn't a
// secret: what each user may read or write is enforced by Skapi itself.
export const SKAPI_PROJECT_ID = '5GJ5SJePWQUiq0jvYr-2ZVgaOLUqOhnse3Hcl8M4d';
export const TABLES = { spellbook: 'spellforge_spellbook', hall: 'spellforge_hall' };
const SDK_URL = 'https://cdn.jsdelivr.net/npm/skapi-js@2.2.28/dist/skapi.js';
const SEEN = 'spellforge.cloud';

let instance = null;
const listeners = new Set();
export const onUser = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (p) => listeners.forEach((fn) => { try { fn(p); } catch (_) { /* a listener's problem */ } });

/** True if this browser has signed in before (so it's fine to wake Skapi on load). */
export function seenBefore() { try { return localStorage.getItem(SEEN) === '1'; } catch (_) { return false; } }
function remember(on) { try { on ? localStorage.setItem(SEEN, '1') : localStorage.removeItem(SEEN); } catch (_) { /* blocked */ } }

function loadScript() {
  if (window.Skapi) return Promise.resolve(window.Skapi);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL; s.async = true;
    s.onload = () => (window.Skapi ? resolve(window.Skapi) : reject(new Error('Skapi did not load')));
    s.onerror = () => reject(new Error('Could not reach Skapi (offline?)'));
    document.head.appendChild(s);
  });
}

/** The Skapi instance, created on first use. */
export function skapi() {
  if (!instance) {
    instance = loadScript().then((Skapi) => new Skapi(SKAPI_PROJECT_ID, {
      eventListener: { onUserUpdate: (p) => { emit(toProfile(p)); } },
    }));
    instance.catch(() => { instance = null; });
  }
  return instance;
}

const toProfile = (p) => (p ? { user_id: p.user_id, email: p.email, name: p.name || '' } : null);
export const errorMessage = (e) => (e && e.message ? String(e.message) : String(e || 'Unknown error'));

// ------------------------------------------------------------ accounts
export async function currentProfile() {
  try { return toProfile(await (await skapi()).getProfile()); } catch (_) { return null; }
}
export async function login(email, password) {
  const p = toProfile(await (await skapi()).login({ email, password }));
  remember(true);
  return p;
}
export async function signup(email, password, name) {
  const res = await (await skapi()).signup({ email, password, ...(name ? { name } : {}) }, { login: true });
  remember(true);
  return typeof res === 'object' ? toProfile(res) : currentProfile();
}
export async function logout() { await (await skapi()).logout(); remember(false); emit(null); }
export async function forgotPassword(email) { return (await skapi()).forgotPassword({ email }); }
export async function resetPassword(email, code, new_password) { return (await skapi()).resetPassword({ email, code, new_password }); }

// ------------------------------------------------------------ records
/** What we store: the genome (share-link encoding, ~1–2 KB) plus a few fields to list it by. */
function payload(genome, extra = {}) {
  return {
    v: 1,
    name: String(genome.meta.name).slice(0, 80),
    hash: hashGenome(genome),
    symmetry: `${genome.symmetry.group}${genome.symmetry.n}`,
    form: genome.form.kind,
    effects: genome.effects.map((e) => String(e.label).slice(0, 60)),
    g: encodeGenome(genome),
    ...extra,
  };
}
/** Turn a stored record back into { record_id, user_id, uploaded, name, hash, …, genome }. Bad records are skipped. */
export function fromRecord(rec) {
  const d = rec && rec.data;
  if (!d || typeof d.g !== 'string') return null;
  try {
    return {
      record_id: rec.record_id, user_id: rec.user_id, uploaded: rec.uploaded,
      name: String(d.name || 'Unnamed Sigil').slice(0, 80), hash: String(d.hash || ''),
      symmetry: String(d.symmetry || ''), form: String(d.form || ''),
      effects: Array.isArray(d.effects) ? d.effects.slice(0, 3).map((x) => String(x).slice(0, 60)) : [],
      by: String(d.by || '').slice(0, 40),
      genome: decodeGenome(d.g),
    };
  } catch (_) { return null; }
}

/** Save to your private Spellbook (only you can read it). */
export async function saveToSpellbook(genome) {
  const rec = await (await skapi()).postRecord(payload(genome), { table: { name: TABLES.spellbook, access_group: 'private' } });
  return fromRecord(rec);
}
/** Your Spellbook, newest first. Pass more=true for the next page. */
export async function listSpellbook({ more = false, limit = 24 } = {}) {
  const res = await (await skapi()).getRecords({ table: { name: TABLES.spellbook, access_group: 'private' } }, { ascending: false, limit, fetchMore: more });
  return { items: (res.list || []).map(fromRecord).filter(Boolean), end: !!res.endOfList };
}

/** Publish to the Hall of Sigils (visible to every member; withdraw it with removeRecord). */
export async function publishToHall(genome, by = '') {
  const rec = await (await skapi()).postRecord(payload(genome, { by: String(by).slice(0, 40) }), { table: { name: TABLES.hall, access_group: 'public' } });
  return fromRecord(rec);
}
/** The Hall, newest first. The shared Skapi project only answers signed-in readers, so the Hall is for members. */
export async function listHall({ more = false, limit = 24 } = {}) {
  const res = await (await skapi()).getRecords({ table: { name: TABLES.hall, access_group: 'public' } }, { ascending: false, limit, fetchMore: more });
  return { items: (res.list || []).map(fromRecord).filter(Boolean), end: !!res.endOfList };
}

/** Delete one of your own records (Spellbook entry or Hall publication). */
export async function removeRecord(record_id) { return (await skapi()).deleteRecords({ record_id }); }
