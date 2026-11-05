import {
  MODULE, t, sign, esc, getEntries, derived, targetText, trackedActors,
  removeEntry, patchEntry, setMoveActive, triggerMove
} from "./store.mjs";
import { addBonusDialog, grantDialog, spendDialog } from "./forms.mjs";

const ID = "motwbt-hud";
let renderTimer = null;

function state() {
  return foundry.utils.mergeObject({ left: 120, top: 90, collapsed: false, actorId: null }, game.settings.get(MODULE, "hudState") ?? {}, { inplace: false });
}
function saveState(patch) {
  return game.settings.set(MODULE, "hudState", { ...state(), ...patch });
}

function candidates() {
  if (game.user.isGM) {
    const list = trackedActors();
    const tok = canvas?.tokens?.controlled?.[0]?.actor;
    if (tok && tok.type === "character" && !list.includes(tok)) list.unshift(tok);
    return list;
  }
  return game.actors.filter((a) => a.type === "character" && a.isOwner);
}

function currentActor() {
  const list = candidates();
  const st = state();
  return list.find((a) => a.id === st.actorId) ?? (game.user.character && list.includes(game.user.character) ? game.user.character : list[0]) ?? null;
}

const canEdit = (e) => game.user.isGM || (e.by === game.user.id && e.source !== "gm");

function row({ value, label, cond, target, badge, controls = "", muted = false, cls = "" }) {
  return `<li class="motwbt-row ${muted ? "is-muted" : ""} ${cls}">
    <span class="motwbt-row__val ${Number(value) < 0 ? "is-neg" : ""}">${value === null ? "•" : sign(value)}</span>
    <span class="motwbt-row__main">
      <span class="motwbt-row__label">${esc(label)}${badge ? ` <span class="motwbt-badge motwbt-badge--${badge}">${esc(t(`Badge.${badge}`))}</span>` : ""}</span>
      ${cond ? `<span class="motwbt-row__cond">${esc(cond)}</span>` : ""}
      ${target ? `<span class="motwbt-row__target"><i class="fa-solid fa-crosshairs"></i> ${esc(target)}</span>` : ""}
    </span>
    <span class="motwbt-row__ctl">${controls}</span>
  </li>`;
}

function build(actor) {
  const st = state();
  const list = candidates();
  const head = `
    <header class="motwbt-hud__head" data-drag>
      <i class="fa-solid fa-dice-d6"></i>
      <span class="motwbt-hud__title">${esc(t("HUD.title"))}</span>
      ${list.length > 1
        ? `<select data-act="pick">${list.map((a) => `<option value="${a.id}" ${a.id === actor?.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>`
        : `<span class="motwbt-hud__name">${esc(actor?.name ?? "")}</span>`}
      <span class="motwbt-hud__btns">
        ${actor ? `<a data-act="grant" data-tooltip="${esc(t("HUD.grant"))}"><i class="fa-solid fa-hand-holding-heart"></i></a>` : ""}
        ${actor && (game.user.isGM || game.settings.get(MODULE, "playersCanAdd")) ? `<a data-act="add" data-tooltip="${esc(t("HUD.add"))}"><i class="fa-solid fa-plus"></i></a>` : ""}
        ${game.user.isGM ? `<a data-act="tracker" data-tooltip="${esc(t("HUD.tracker"))}"><i class="fa-solid fa-table-list"></i></a>` : ""}
        <a data-act="collapse" data-tooltip="${esc(t(st.collapsed ? "HUD.expand" : "HUD.collapse"))}"><i class="fa-solid ${st.collapsed ? "fa-chevron-down" : "fa-chevron-up"}"></i></a>
      </span>
    </header>`;
  if (!actor) return head + `<div class="motwbt-hud__body"><p class="motwbt-empty">${esc(t("HUD.noActor"))}</p></div>`;
  if (st.collapsed) {
    const n = summary(actor);
    return head.replace("</header>", `<span class="motwbt-hud__sum">${n}</span></header>`);
  }

  const entries = getEntries(actor);
  const ders = derived(actor);
  const engaged = [];
  const available = [];
  const reserves = [];
  const others = [];

  for (const e of entries) {
    const target = targetText(actor, e);
    const del = canEdit(e) ? `<a data-act="del" data-id="${e.id}" data-tooltip="${esc(t("HUD.remove"))}"><i class="fa-solid fa-xmark"></i></a>` : "";
    if (e.kind === "constant") engaged.push(row({ value: e.value, label: e.label, target, badge: "constant", controls: del }));
    else if (e.kind === "forward") engaged.push(row({ value: e.value, label: e.label, target, badge: "forward", controls: del }));
    else if (e.kind === "ongoing") {
      const tog = `<input type="checkbox" data-act="toggleEntry" data-id="${e.id}" ${e.active !== false ? "checked" : ""} data-tooltip="${esc(t("HUD.toggle"))}">`;
      (e.active !== false ? engaged : available).push(row({ value: e.value, label: e.label, target, badge: "ongoing", controls: tog + del }));
    } else if (e.kind === "pool") {
      const spend = `<button type="button" data-act="spendEntry" data-id="${e.id}">${esc(t("HUD.spend"))} <b>${e.qty}</b></button>`;
      reserves.push(row({ value: null, label: e.label, cond: e.max ? t("HUD.maxPer", { n: e.max }) : "", target: null, badge: "pool", controls: spend + del }));
    } else if (e.kind === "hold") {
      const ctl = `<a data-act="holdDown" data-id="${e.id}"><i class="fa-solid fa-minus"></i></a><b class="motwbt-qty">${e.qty}</b>` +
        (game.user.isGM ? `<a data-act="holdUp" data-id="${e.id}"><i class="fa-solid fa-plus"></i></a>` : "");
      reserves.push(row({ value: null, label: e.label, badge: "hold", controls: ctl + del }));
    } else if (e.kind === "note") {
      others.push(row({ value: e.value || null, label: e.label, controls: del, muted: true }));
    }
  }

  for (const d of ders) {
    const target = d.stats.length || d.moves.length ? targetText(actor, d) : t("Target.any");
    if (d.mode === "toggle" || d.mode === "situational") {
      const ctl = `<input type="checkbox" data-act="toggleMove" data-id="${d.id}" ${d.active ? "checked" : ""} data-tooltip="${esc(t(d.mode === "toggle" ? "HUD.toggle" : "HUD.arm"))}">`;
      (d.active ? engaged : available).push(row({ value: d.value, label: d.label, cond: d.cond, target, badge: d.mode, controls: ctl }));
    } else if (d.mode === "trigger") {
      available.push(row({ value: d.value, label: d.label, cond: d.cond, target, badge: "trigger", controls: `<button type="button" data-act="trigger" data-id="${d.id}">${esc(t("HUD.take"))}</button>` }));
    } else if (d.mode === "pool") {
      available.push(row({ value: null, label: d.label, cond: d.cond, target, badge: "pool", controls: `<button type="button" data-act="spendMove" data-id="${d.id}">${esc(t("HUD.spend"))}</button>` }));
    } else if (d.mode === "info") {
      others.push(row({ value: d.value, label: d.label, cond: d.cond, badge: d.kind, muted: true }));
    }
  }

  const section = (key, items, open = true) =>
    items.length ? `<details class="motwbt-sec" ${open ? "open" : ""}><summary>${esc(t(`HUD.${key}`))} <span>${items.length}</span></summary><ul>${items.join("")}</ul></details>` : "";

  return head + `<div class="motwbt-hud__body">
    <div class="motwbt-next"><span>${esc(t("HUD.next"))}</span><b>${summary(actor)}</b></div>
    ${section("engaged", engaged)}
    ${section("available", available)}
    ${section("reserves", reserves)}
    ${section("others", others, false)}
    ${!engaged.length && !available.length && !reserves.length && !others.length ? `<p class="motwbt-empty">${esc(t("HUD.empty"))}</p>` : ""}
  </div>`;
}

/** Résumé « tout jet » : somme de ce qui s'applique à n'importe quel jet. */
function summary(actor) {
  let any = 0;
  let targeted = 0;
  for (const e of getEntries(actor)) {
    if (!["constant", "forward", "ongoing"].includes(e.kind) || (e.kind === "ongoing" && e.active === false)) continue;
    if (!e.stats?.length && !e.moves?.length) any += Number(e.value) || 0;
    else targeted++;
  }
  for (const d of derived(actor)) {
    if (!["toggle", "situational"].includes(d.mode) || !d.active) continue;
    if (!d.stats.length && !d.moves.length) any += d.value;
    else targeted++;
  }
  let s = sign(any);
  if (targeted) s += ` <small>${esc(t("HUD.targeted", { n: targeted }))}</small>`;
  return s;
}

async function onAction(ev) {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (ev.type === "click" && (el.tagName === "SELECT" || el.type === "checkbox")) return;
  if (ev.type === "change" && !(el.tagName === "SELECT" || el.type === "checkbox")) return;
  const actor = currentActor();
  const id = el.dataset.id;
  switch (act) {
    case "pick": await saveState({ actorId: el.value }); return render();
    case "collapse": await saveState({ collapsed: !state().collapsed }); return render();
    case "tracker": return game.modules.get(MODULE).api.openTracker();
    case "grant": return grantDialog(actor);
    case "add": return addBonusDialog(actor);
    case "del": return removeEntry(actor, id);
    case "toggleEntry": return patchEntry(actor, id, { active: el.checked });
    case "toggleMove": return setMoveActive(actor, id, el.checked);
    case "trigger": { const d = derived(actor).find((x) => x.id === id); return d && triggerMove(actor, d); }
    case "spendMove": { const d = derived(actor).find((x) => x.id === id); return d && spendDialog(actor, d); }
    case "spendEntry": { const e = getEntries(actor).find((x) => x.id === id); return e && spendDialog(actor, e); }
    case "holdDown": { const e = getEntries(actor).find((x) => x.id === id); return e && e.qty > 0 && patchEntry(actor, id, { qty: e.qty - 1 }, t("Log.holdSpent", { label: e.label })); }
    case "holdUp": { const e = getEntries(actor).find((x) => x.id === id); return e && patchEntry(actor, id, { qty: (e.qty || 0) + 1 }); }
  }
}

function makeDraggable(root) {
  root.addEventListener("pointerdown", (ev) => {
    const head = ev.target.closest("[data-drag]");
    if (!head || ev.target.closest("a, select, input, button")) return;
    ev.preventDefault();
    const r = root.getBoundingClientRect();
    const dx = ev.clientX - r.left;
    const dy = ev.clientY - r.top;
    const move = (e) => {
      root.style.left = `${Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dx))}px`;
      root.style.top = `${Math.max(0, Math.min(window.innerHeight - 30, e.clientY - dy))}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      saveState({ left: parseInt(root.style.left), top: parseInt(root.style.top) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

export function render() {
  if (!game.settings.get(MODULE, "hudEnabled")) {
    document.getElementById(ID)?.remove();
    return;
  }
  let root = document.getElementById(ID);
  if (!root) {
    root = document.createElement("section");
    root.id = ID;
    root.className = "motwbt-hud";
    document.body.appendChild(root);
    root.addEventListener("click", onAction);
    root.addEventListener("change", onAction);
    makeDraggable(root);
  }
  const st = state();
  root.style.left = `${st.left}px`;
  root.style.top = `${st.top}px`;
  root.classList.toggle("is-collapsed", !!st.collapsed);
  const actor = currentActor();
  const open = [...root.querySelectorAll("details.motwbt-sec")].map((d) => d.open);
  root.innerHTML = build(actor);
  root.querySelectorAll("details.motwbt-sec").forEach((d, i) => { if (open[i] !== undefined) d.open = open[i]; });
}

export function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    render();
    game.modules.get(MODULE)?.api?.tracker?.rendered && game.modules.get(MODULE).api.tracker.render();
  }, 60);
}
