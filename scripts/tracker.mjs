import {
  MODULE, t, sign, esc, getEntries, getLog, derived, targetText, trackedActors,
  addEntry, removeEntry, patchEntry, setMoveActive, endScope
} from "./store.mjs";
import { addBonusDialog, addToAllDialog } from "./forms.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** Fenêtre MJ : tous les chasseurs, tous leurs bonus. */
export class BonusTracker extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "motwbt-tracker",
    classes: ["motwbt-tracker"],
    window: { title: "MOTWBT.Tracker.title", icon: "fa-solid fa-table-list", resizable: true },
    position: { width: 760, height: 600 },
    actions: {
      add: BonusTracker.#onAdd,
      quick: BonusTracker.#onQuick,
      all: BonusTracker.#onAll,
      del: BonusTracker.#onDel,
      toggleEntry: BonusTracker.#onToggleEntry,
      toggleMove: BonusTracker.#onToggleMove,
      hold: BonusTracker.#onHold,
      endScene: () => endScope("scene"),
      endSession: BonusTracker.#onEndSession,
      sheet: BonusTracker.#onSheet
    }
  };

  async _renderHTML() {
    const actors = trackedActors();
    if (!actors.length) return `<p class="motwbt-empty">${esc(t("Tracker.none"))}</p>`;
    const toolbar = `<div class="motwbt-tracker__bar">
      <button type="button" data-action="all"><i class="fa-solid fa-users"></i> ${esc(t("Tracker.all"))}</button>
      <button type="button" data-action="endScene"><i class="fa-solid fa-clapperboard"></i> ${esc(t("Tracker.endScene"))}</button>
      <button type="button" data-action="endSession"><i class="fa-solid fa-moon"></i> ${esc(t("Tracker.endSession"))}</button>
    </div>`;
    return toolbar + actors.map((a) => this.#card(a)).join("");
  }

  #card(actor) {
    const chip = (o) => `<li class="motwbt-chip motwbt-chip--${o.badge} ${o.off ? "is-off" : ""}" data-tooltip="${esc(o.tip ?? "")}">
      <b>${o.value === null ? "•" : sign(o.value)}</b> ${esc(o.label)}
      ${o.target ? `<span class="motwbt-chip__tgt">→ ${esc(o.target)}</span>` : ""}
      ${o.ctl ?? ""}</li>`;
    const chips = [];
    for (const e of getEntries(actor)) {
      const target = e.stats?.length || e.moves?.length ? targetText(actor, e) : "";
      const del = `<a data-action="del" data-actor="${actor.id}" data-id="${e.id}"><i class="fa-solid fa-xmark"></i></a>`;
      if (e.kind === "ongoing") {
        const tog = `<a data-action="toggleEntry" data-actor="${actor.id}" data-id="${e.id}"><i class="fa-solid ${e.active !== false ? "fa-toggle-on" : "fa-toggle-off"}"></i></a>`;
        chips.push(chip({ value: e.value, label: e.label, target, badge: "ongoing", off: e.active === false, tip: t(`Expires.${e.expires}`), ctl: tog + del }));
      } else if (e.kind === "pool" || e.kind === "hold") {
        const ctl = `<a data-action="hold" data-delta="-1" data-actor="${actor.id}" data-id="${e.id}"><i class="fa-solid fa-minus"></i></a>` +
          `<span class="motwbt-qty">${e.qty}</span><a data-action="hold" data-delta="1" data-actor="${actor.id}" data-id="${e.id}"><i class="fa-solid fa-plus"></i></a>`;
        chips.push(chip({ value: null, label: e.label, badge: e.kind, tip: t(`Kind.${e.kind}`), ctl: ctl + del }));
      } else {
        chips.push(chip({ value: e.kind === "note" ? e.value || null : e.value, label: e.label, target, badge: e.kind, tip: `${t(`Kind.${e.kind}`)} · ${t(`Expires.${e.expires}`)}`, ctl: del }));
      }
    }
    const moves = derived(actor).map((d) => {
      const target = d.stats.length || d.moves.length ? targetText(actor, d) : "";
      const ctl = ["toggle", "situational"].includes(d.mode)
        ? `<a data-action="toggleMove" data-actor="${actor.id}" data-id="${d.id}"><i class="fa-solid ${d.active ? "fa-toggle-on" : "fa-toggle-off"}"></i></a>`
        : "";
      return chip({ value: d.mode === "pool" ? null : d.value, label: d.label, target, badge: d.mode === "info" ? d.kind : d.mode, off: ["toggle", "situational"].includes(d.mode) && !d.active, tip: d.cond, ctl });
    });
    const log = getLog(actor).slice(-6).reverse().map((l) =>
      `<li><time>${new Date(l.t).toLocaleTimeString(game.i18n.lang, { hour: "2-digit", minute: "2-digit" })}</time> ${esc(l.text)} <em>(${esc(l.u)})</em></li>`).join("");
    return `<section class="motwbt-card">
      <header>
        <img src="${esc(actor.img)}" alt="" data-action="sheet" data-actor="${actor.id}">
        <h3 data-action="sheet" data-actor="${actor.id}">${esc(actor.name)}</h3>
        <span class="motwbt-card__btns">
          <button type="button" data-action="quick" data-kind="forward" data-actor="${actor.id}">+1 ${esc(t("Kind.forward"))}</button>
          <button type="button" data-action="quick" data-kind="ongoing" data-actor="${actor.id}">+1 ${esc(t("Kind.ongoing"))}</button>
          <button type="button" data-action="add" data-actor="${actor.id}"><i class="fa-solid fa-plus"></i> ${esc(t("Tracker.add"))}</button>
        </span>
      </header>
      <div class="motwbt-card__cols">
        <div><h4>${esc(t("Tracker.entries"))}</h4><ul class="motwbt-chips">${chips.join("") || `<li class="motwbt-empty">—</li>`}</ul></div>
        <div><h4>${esc(t("Tracker.moves"))}</h4><ul class="motwbt-chips">${moves.join("") || `<li class="motwbt-empty">—</li>`}</ul></div>
      </div>
      ${log ? `<details class="motwbt-log"><summary>${esc(t("Tracker.log"))}</summary><ul>${log}</ul></details>` : ""}
    </section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static #actor(target) {
    return game.actors.get(target.closest("[data-actor]")?.dataset.actor);
  }
  static async #onAdd(event, target) {
    const a = BonusTracker.#actor(target);
    if (a) await addBonusDialog(a);
  }
  static async #onQuick(event, target) {
    const a = BonusTracker.#actor(target);
    const kind = target.dataset.kind;
    if (a) await addEntry(a, { label: t(`Kind.${kind}`), kind, value: 1, expires: kind === "forward" ? "roll" : "scene" });
  }
  static async #onAll() {
    await addToAllDialog();
  }
  static async #onDel(event, target) {
    const a = BonusTracker.#actor(target);
    if (a) await removeEntry(a, target.dataset.id);
  }
  static async #onToggleEntry(event, target) {
    const a = BonusTracker.#actor(target);
    const e = getEntries(a).find((x) => x.id === target.dataset.id);
    if (e) await patchEntry(a, e.id, { active: e.active === false });
  }
  static async #onToggleMove(event, target) {
    const a = BonusTracker.#actor(target);
    const d = derived(a).find((x) => x.id === target.dataset.id);
    if (d) await setMoveActive(a, d.id, !d.active);
  }
  static async #onHold(event, target) {
    const a = BonusTracker.#actor(target);
    const e = getEntries(a).find((x) => x.id === target.dataset.id);
    if (!e) return;
    const qty = Math.max(0, (Number(e.qty) || 0) + Number(target.dataset.delta));
    await patchEntry(a, e.id, { qty });
  }
  static async #onEndSession() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("Tracker.endSession") },
      content: `<p>${esc(t("Tracker.endSessionConfirm"))}</p>`
    });
    if (ok) await endScope("session");
  }
  static #onSheet(event, target) {
    BonusTracker.#actor(target)?.sheet.render(true);
  }
}
