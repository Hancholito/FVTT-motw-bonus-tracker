import { MODULE, t, sign, esc, itemKey, computeForRoll, consumeAfterRoll } from "./store.mjs";

/**
 * Point d'accroche dans le système PbtA (vérifié sur pbta 1.x, Foundry v13/v14) :
 *  - ItemPbtA#roll et ActorPbtA#_onRollStat construisent un RollPbtA avec leurs options ;
 *    on y glisse l'acteur et la manœuvre (options.motwbt).
 *  - RollPbtA#configureDialog : on ajoute un groupe de conditions « marqueur » pour forcer
 *    l'affichage de la fenêtre de jet quand des bonus existent, puis on le remplace par notre rappel.
 *  - RollPbtA#configureModifiers est appelé une seule fois, juste avant l'évaluation, avec ou
 *    sans fenêtre : on y ajoute les termes de bonus. Le système recompile ensuite la formule.
 * Si le système change, c'est ce fichier seul qu'il faut adapter.
 */

const MARKER = "__motwbt__";

/** Jet en cours de préparation (fenêtre ouverte). */
let PENDING = null;

function wrap(path, fn) {
  if (game.modules.get("lib-wrapper")?.active && globalThis.libWrapper) {
    libWrapper.register(MODULE, path, fn, "WRAPPER");
    return;
  }
  const parts = path.split(".");
  const name = parts.pop();
  const obj = parts.reduce((o, k) => o?.[k], globalThis);
  if (!obj || typeof obj[name] !== "function") {
    console.warn(`${MODULE} | impossible d'accrocher ${path}`);
    return;
  }
  const original = obj[name];
  obj[name] = function (...args) {
    return fn.call(this, original.bind(this), ...args);
  };
}

function resolveStat(roll) {
  const o = roll.options ?? {};
  if (o.stat && typeof o.stat === "object" && o.stat.key) return o.stat.key;
  if (typeof o.stat === "string") return o.stat;
  if (o.rollType && roll.data?.stats?.[o.rollType]) return o.rollType;
  return null;
}

function rollContext(roll) {
  const ctx = roll.options?.motwbt;
  if (!ctx) return null;
  const actor = fromUuidSync(ctx.actor);
  if (!actor) return null;
  const item = ctx.item ? actor.items.get(ctx.item) : null;
  return { actor, item, stat: resolveStat(roll), moveKey: item ? itemKey(item) : null, itemId: item?.id ?? null };
}

function pushBonus(roll, value) {
  const { OperatorTerm, NumericTerm } = foundry.dice.terms;
  roll.terms.push(new OperatorTerm({ operator: value < 0 ? "-" : "+" }));
  roll.terms.push(new NumericTerm({ number: Math.abs(value) }));
}

function applyBonuses(roll) {
  if (roll.options.motwbtDone) return;
  roll.options.motwbtDone = true;
  const ctx = rollContext(roll);
  if (!ctx) return;
  const overrides = PENDING?.actor === ctx.actor.uuid ? PENDING.overrides : {};
  const res = computeForRoll(ctx.actor, ctx, overrides);
  if (!res.applied.length) return;
  roll.options.conditions ??= [];
  for (const a of res.applied) {
    if (!a.value) continue;
    pushBonus(roll, a.value);
    let txt = `${a.label} (${sign(a.value)})`;
    if (a.keeperHold) txt += ` — ${t("Chat.keeperHold", { n: Math.abs(a.value) })}`;
    roll.options.conditions.push(txt);
  }
  roll.options.motwbtApplied = res.applied;
  consumeAfterRoll(ctx.actor, res).catch((e) => console.error(`${MODULE} |`, e));
}

export function registerRollHooks() {
  // 1. Contexte acteur / manœuvre
  wrap("CONFIG.Item.documentClass.prototype.roll", async function (wrapped, options = {}) {
    if (this.actor && this.type === "move" && !options.descriptionOnly) {
      options.motwbt = { actor: this.actor.uuid, item: this.id };
      const rt = this.system?.rollType;
      PENDING = {
        actor: this.actor.uuid,
        overrides: {},
        itemId: this.id,
        moveKey: itemKey(this),
        stat: rt && this.actor.system?.stats?.[rt] ? rt : null
      };
    }
    try {
      return await wrapped(options);
    } finally {
      PENDING = null;
    }
  });
  wrap("CONFIG.Actor.documentClass.prototype._onRollStat", async function (wrapped, stat, label, options = {}) {
    options ??= {};
    options.motwbt = { actor: this.uuid };
    PENDING = { actor: this.uuid, overrides: {}, stat: typeof stat === "string" ? stat : null };
    try {
      return await wrapped(stat, label, options);
    } finally {
      PENDING = null;
    }
  });

  // 2. Forcer la fenêtre de jet quand un bonus est engagé ou disponible
  wrap("CONFIG.Dice.RollPbtA.prototype.configureDialog", function (wrapped, ...args) {
    try {
      if (game.settings.get(MODULE, "forceDialog")) {
        const ctx = rollContext(this);
        if (ctx) {
          const res = computeForRoll(ctx.actor, ctx);
          if (res.applied.length || res.available.length) {
            this.data.conditionGroups = [...(this.data.conditionGroups ?? []), { label: MARKER, conditions: [] }];
          }
        }
      }
    } catch (e) {
      console.error(`${MODULE} |`, e);
    }
    return wrapped(...args);
  });

  // 3. Injection des bonus
  wrap("CONFIG.Dice.RollPbtA.prototype.configureModifiers", function (wrapped, ...args) {
    try {
      applyBonuses(this);
    } catch (e) {
      console.error(`${MODULE} |`, e);
    }
    return wrapped(...args);
  });

  // 4. Rappel dans la fenêtre de jet
  Hooks.on("renderDialog", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const form = root?.querySelector?.("form.roll-dialog");
    if (!form || !PENDING) return;
    const marker = [...form.querySelectorAll("strong")].find((s) => s.textContent.trim() === MARKER);
    if (!marker) return;
    const li = marker.closest("li");
    const actor = fromUuidSync(PENDING.actor);
    if (!actor || !li) return;
    const ctx = { stat: PENDING.stat ?? null, moveKey: PENDING.moveKey ?? null, itemId: PENDING.itemId ?? null };
    const res = computeForRoll(actor, ctx, PENDING.overrides);
    const row = (a, checked) =>
      `<li><label class="flexrow motwbt-dlg__row"><input type="checkbox" data-motwbt="${esc(a.id)}" ${checked ? "checked" : ""}/>` +
      `<span class="motwbt-dlg__val">${sign(a.value)}</span><span>${esc(a.label)}${a.cond ? ` <em>— ${esc(a.cond)}</em>` : ""}</span></label></li>`;
    li.classList.add("motwbt-dlg");
    li.innerHTML =
      `<strong>${esc(t("Dialog.title"))}</strong><p class="notes">${esc(t("Dialog.hint"))}</p>` +
      `<ul>${res.applied.map((a) => row(a, true)).join("")}${res.available.map((a) => row(a, false)).join("")}</ul>`;
    li.querySelectorAll("input[data-motwbt]").forEach((cb) =>
      cb.addEventListener("change", (ev) => {
        if (PENDING) PENDING.overrides[ev.currentTarget.dataset.motwbt] = ev.currentTarget.checked;
      })
    );
    app.setPosition?.({ height: "auto" });
  });
}
