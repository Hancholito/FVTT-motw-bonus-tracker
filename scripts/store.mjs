import { REGISTRY, MOVE_NAMES, NAME_INDEX } from "./registry.mjs";

export const MODULE = "motw-bonus-tracker";
export const SOCKET = `module.${MODULE}`;

/** Types d'entrées stockées sur le personnage. */
export const KINDS = ["forward", "ongoing", "constant", "pool", "hold", "note"];
/** Types qui s'ajoutent réellement au jet. */
const ROLL_KINDS = ["forward", "ongoing", "constant"];
export const EXPIRES = ["roll", "scene", "session", "never"];

/* ---------------------------------------------------------------- */
/*  Petits utilitaires                                               */
/* ---------------------------------------------------------------- */

export const t = (k, data) => (data ? game.i18n.format(`MOTWBT.${k}`, data) : game.i18n.localize(`MOTWBT.${k}`));
export const lang = () => (game.i18n.lang?.startsWith("fr") ? "fr" : "en");
export const sign = (v) => (Number(v) >= 0 ? `+${Number(v)}` : `${Number(v)}`);
export const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Clé de registre d'une manœuvre possédée : "<pack>/<id>" d'origine, sinon par le nom (FR ou EN). */
export function itemKey(item) {
  if (!item) return null;
  const src = item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? "";
  const m = /^Compendium\.[^.]+\.([^.]+)\.(?:Item\.)?([A-Za-z0-9]{16})$/.exec(src);
  if (m) return `${m[1]}/${m[2]}`;
  return NAME_INDEX[norm(item.name)] ?? null;
}

/** Personnages joueurs suivis. */
export function trackedActors() {
  return game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
}

export function isResponsibleGM() {
  const gm = game.users.activeGM ?? game.users.find((u) => u.isGM && u.active);
  return gm?.isSelf ?? false;
}

/* ---------------------------------------------------------------- */
/*  Lecture                                                          */
/* ---------------------------------------------------------------- */

export function getEntries(actor) {
  return foundry.utils.deepClone(actor?.getFlag(MODULE, "entries") ?? []);
}

export function getMoveState(actor) {
  return foundry.utils.deepClone(actor?.getFlag(MODULE, "moveState") ?? {});
}

export function getLog(actor) {
  return actor?.getFlag(MODULE, "log") ?? [];
}

/** Bonus issus des manœuvres du personnage, d'après la table de correspondance. */
export function derived(actor) {
  if (!actor) return [];
  const showBasic = game.settings.get(MODULE, "showBasicMoves");
  const state = getMoveState(actor);
  const out = [];
  for (const item of actor.items) {
    if (item.type !== "move") continue;
    const key = itemKey(item);
    const defs = key ? REGISTRY[key] : null;
    if (!defs) continue;
    if (!showBasic && key.startsWith("basic-moves/")) continue;
    defs.forEach((def, idx) => {
      const mid = `m:${item.id}:${idx}`;
      out.push({
        id: mid,
        itemId: item.id,
        idx,
        key,
        derived: true,
        mode: def.mode,
        kind: def.kind,
        label: item.name,
        cond: def.cond?.[lang()] ?? def.cond?.en ?? "",
        value: def.value,
        stats: def.stats ?? [],
        moves: def.moves ?? [],
        max: def.max,
        keeperHold: !!def.keeperHold,
        expires: def.expires ?? "never",
        active: !!state[`${item.id}_${idx}`]?.active
      });
    });
  }
  return out;
}

/** Nom lisible d'une manœuvre cible (préférence : la manœuvre possédée par le personnage). */
export function moveLabel(actor, mk) {
  if (mk.startsWith("item:")) return actor?.items.get(mk.slice(5))?.name ?? "?";
  const own = actor?.items.find((i) => i.type === "move" && itemKey(i) === mk);
  if (own) return own.name;
  return MOVE_NAMES[mk]?.[lang()] ?? MOVE_NAMES[mk]?.en ?? mk;
}

export function statLabel(actor, k) {
  return actor?.system?.stats?.[k]?.label ?? game.pbta?.sheetConfig?.actorTypes?.character?.stats?.[k]?.label ?? k;
}

/** Texte de la cible : « tout jet », « Futé », « Agir sous pression »… */
export function targetText(actor, e) {
  const parts = [...(e.stats ?? []).map((k) => statLabel(actor, k)), ...(e.moves ?? []).map((m) => moveLabel(actor, m))];
  return parts.length ? parts.join(", ") : t("Target.any");
}

/** Liste des cibles proposées dans les formulaires. */
export function targetOptions(actor) {
  const stats = Object.keys(actor?.system?.stats ?? {}).map((k) => ({ value: `stat:${k}`, label: statLabel(actor, k) }));
  const moves = (actor?.items ?? [])
    .filter((i) => i.type === "move" && i.system?.rollType)
    .map((i) => ({ value: `move:${itemKey(i) ?? `item:${i.id}`}`, label: i.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { stats, moves };
}

export function parseTarget(v) {
  if (!v || v === "any") return { stats: [], moves: [] };
  if (v.startsWith("stat:")) return { stats: [v.slice(5)], moves: [] };
  if (v.startsWith("move:")) return { stats: [], moves: [v.slice(5)] };
  return { stats: [], moves: [] };
}

/* ---------------------------------------------------------------- */
/*  Calcul pour un jet                                               */
/* ---------------------------------------------------------------- */

function matches(e, ctx) {
  const stats = e.stats ?? [];
  const moves = e.moves ?? [];
  if (!stats.length && !moves.length) return true;
  if (ctx.stat && stats.includes(ctx.stat)) return true;
  if (ctx.moveKey && moves.includes(ctx.moveKey)) return true;
  if (ctx.itemId && moves.includes(`item:${ctx.itemId}`)) return true;
  return false;
}

/**
 * Détermine les bonus qui s'appliquent à un jet.
 * @param {Actor} actor
 * @param {{stat?:string, moveKey?:string, itemId?:string}} ctx
 * @param {Record<string,boolean>} overrides  choix faits dans la fenêtre de jet
 */
export function computeForRoll(actor, ctx, overrides = {}) {
  const applied = [];
  const available = [];
  const remove = [];
  const disarm = [];
  for (const e of getEntries(actor)) {
    if (!ROLL_KINDS.includes(e.kind) || !matches(e, ctx)) continue;
    let on = e.kind === "ongoing" ? e.active !== false : true;
    if (e.id in overrides) on = overrides[e.id];
    const row = { id: e.id, label: e.label, value: Number(e.value) || 0, kind: e.kind, keeperHold: !!e.keeperHold };
    (on ? applied : available).push(row);
    if (on && e.kind === "forward") remove.push(e.id);
  }
  for (const d of derived(actor)) {
    if (!["toggle", "situational"].includes(d.mode) || !matches(d, ctx)) continue;
    let on = d.active;
    if (d.id in overrides) on = overrides[d.id];
    const row = { id: d.id, label: d.label, cond: d.cond, value: d.value, kind: d.mode };
    (on ? applied : available).push(row);
    if (on && d.mode === "situational" && d.active) disarm.push(`${d.itemId}_${d.idx}`);
  }
  return { applied, available, remove, disarm };
}

/* ---------------------------------------------------------------- */
/*  Écriture                                                         */
/* ---------------------------------------------------------------- */

function logLine(actor, text) {
  const log = [...getLog(actor), { t: Date.now(), u: game.user.name, text }];
  return log.slice(-20);
}

async function commit(actor, { entries, moveState, log } = {}) {
  const upd = {};
  if (entries) upd[`flags.${MODULE}.entries`] = entries;
  if (moveState) for (const [k, v] of Object.entries(moveState)) upd[`flags.${MODULE}.moveState.${k}`] = v;
  if (log) upd[`flags.${MODULE}.log`] = logLine(actor, log);
  if (Object.keys(upd).length) await actor.update(upd);
}

/** Envoie une opération au MJ quand on n'a pas les droits sur le personnage. */
async function viaGM(op, actor, payload) {
  if (actor.isOwner) return false;
  if (!game.users.activeGM) {
    ui.notifications.warn(t("Notify.noGM"));
    return true;
  }
  game.socket.emit(SOCKET, { op, actor: actor.uuid, payload, from: game.user.id });
  return true;
}

export function newEntry(data) {
  return foundry.utils.mergeObject(
    {
      id: foundry.utils.randomID(),
      label: "",
      kind: "forward",
      value: 1,
      stats: [],
      moves: [],
      qty: 0,
      max: null,
      expires: "roll",
      active: true,
      source: game.user.isGM ? "gm" : "player",
      by: game.user.id,
      at: Date.now()
    },
    data,
    { inplace: false }
  );
}

export async function addEntry(actor, data) {
  const entry = data.id ? data : newEntry(data);
  if (await viaGM("add", actor, entry)) return;
  const entries = getEntries(actor);
  entries.push(entry);
  await commit(actor, { entries, log: t("Log.added", { label: entry.label || t(`Kind.${entry.kind}`), value: ["pool", "hold"].includes(entry.kind) ? `×${entry.qty}` : sign(entry.value), kind: t(`Kind.${entry.kind}`) }) });
}

export async function removeEntry(actor, id) {
  const entries = getEntries(actor);
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  await commit(actor, { entries: entries.filter((x) => x.id !== id), log: t("Log.removed", { label: e.label || t(`Kind.${e.kind}`) }) });
}

export async function patchEntry(actor, id, patch, log) {
  const entries = getEntries(actor);
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  await commit(actor, { entries, log });
}

export async function setMoveActive(actor, mid, active) {
  const [, itemId, idx] = mid.split(":");
  await commit(actor, { moveState: { [`${itemId}_${idx}`]: { active } } });
}

/** Dépense des points d'une réserve « à dépenser » : crée un forward ciblé. */
export async function spendPool(actor, source, amount, target) {
  amount = Math.max(1, Number(amount) || 1);
  const tgt = parseTarget(target);
  const entries = getEntries(actor);
  if (source.derived) {
    if (source.max) amount = Math.min(amount, source.max);
    const fw = newEntry({
      kind: "forward",
      value: amount,
      label: source.label,
      stats: source.stats?.length || source.moves?.length ? source.stats : tgt.stats,
      moves: source.stats?.length || source.moves?.length ? source.moves : tgt.moves,
      keeperHold: source.keeperHold,
      source: "move"
    });
    entries.push(fw);
    await commit(actor, { entries, log: t("Log.engaged", { label: source.label, value: sign(amount) }) });
    return;
  }
  const pool = entries.find((x) => x.id === source.id);
  if (!pool) return;
  amount = Math.min(amount, Number(pool.qty) || 0, pool.max || Infinity);
  if (amount <= 0) return;
  pool.qty = (Number(pool.qty) || 0) - amount;
  const fw = newEntry({ kind: "forward", value: amount, label: pool.label || t("Kind.pool"), stats: tgt.stats, moves: tgt.moves, source: "pool" });
  const next = entries.filter((x) => x.id !== pool.id || pool.qty > 0);
  next.push(fw);
  await commit(actor, { entries: next, log: t("Log.engaged", { label: fw.label, value: sign(amount) }) });
}

/** Déclenche une manœuvre qui donne un forward (« prenez +1 forward »). */
export async function triggerMove(actor, d) {
  const entries = getEntries(actor);
  entries.push(newEntry({ kind: "forward", value: d.value, label: d.label, stats: d.stats, moves: d.moves, source: "move" }));
  await commit(actor, { entries, log: t("Log.triggered", { label: d.label, value: sign(d.value) }) });
}

/** Après un jet : consomme les forwards et désarme les bonus situationnels. */
export async function consumeAfterRoll(actor, res) {
  if (!res.remove.length && !res.disarm.length) return;
  const entries = getEntries(actor).filter((e) => !res.remove.includes(e.id));
  const moveState = Object.fromEntries(res.disarm.map((k) => [k, { active: false }]));
  const text = res.applied.map((a) => `${a.label} ${sign(a.value)}`).join(", ");
  await commit(actor, { entries, moveState, log: t("Log.rolled", { list: text }) });
}

/** Fin de scène / de session : retire ce qui expire. */
export async function endScope(scope) {
  const scopes = scope === "session" ? ["scene", "session"] : ["scene"];
  for (const actor of trackedActors()) {
    const entries = getEntries(actor);
    const keep = entries.filter((e) => !scopes.includes(e.expires));
    const moveState = {};
    for (const d of derived(actor)) if (d.active && scopes.includes(d.expires)) moveState[`${d.itemId}_${d.idx}`] = { active: false };
    if (scope === "session") for (const d of derived(actor)) if (d.active && d.mode === "situational") moveState[`${d.itemId}_${d.idx}`] = { active: false };
    if (keep.length !== entries.length || Object.keys(moveState).length) {
      await commit(actor, { entries: keep, moveState, log: t(scope === "session" ? "Log.endSession" : "Log.endScene") });
    }
  }
  ui.notifications.info(t(scope === "session" ? "Notify.endSession" : "Notify.endScene"));
}

/* ---------------------------------------------------------------- */
/*  Socket (exécuté par le MJ responsable)                           */
/* ---------------------------------------------------------------- */

export function registerSocket() {
  game.socket.on(SOCKET, async (msg) => {
    if (!isResponsibleGM()) return;
    const actor = await fromUuid(msg.actor);
    if (!actor) return;
    if (msg.op === "add") {
      const entry = msg.payload;
      const entries = getEntries(actor);
      entries.push(entry);
      const from = game.users.get(msg.from)?.name ?? "?";
      await commit(actor, { entries, log: t("Log.granted", { from, label: entry.label, value: sign(entry.value), kind: t(`Kind.${entry.kind}`) }) });
    }
  });
}
