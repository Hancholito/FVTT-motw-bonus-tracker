import { t, esc, sign, KINDS, EXPIRES, targetOptions, parseTarget, trackedActors, addEntry, spendPool } from "./store.mjs";

const DialogV2 = () => foundry.applications.api.DialogV2;
const FDE = () => foundry.applications.ux.FormDataExtended;

function targetSelect(actor, name = "target", selected = "any", { allowAny = true } = {}) {
  const { stats, moves } = targetOptions(actor);
  const opt = (o) => `<option value="${esc(o.value)}" ${o.value === selected ? "selected" : ""}>${esc(o.label)}</option>`;
  return (
    `<select name="${name}">` +
    (allowAny ? `<option value="any">${esc(t("Target.any"))}</option>` : "") +
    `<optgroup label="${esc(t("Target.stats"))}">${stats.map(opt).join("")}</optgroup>` +
    `<optgroup label="${esc(t("Target.moves"))}">${moves.map(opt).join("")}</optgroup>` +
    `</select>`
  );
}

async function prompt(title, content, okLabel) {
  return DialogV2().prompt({
    window: { title },
    position: { width: 420 },
    content: `<div class="motwbt-form">${content}</div>`,
    ok: { label: okLabel ?? t("Form.ok"), callback: (event, button) => new (FDE())(button.form).object },
    rejectClose: false
  });
}

/** Ajout d'un bonus (MJ, ou joueur si le réglage l'autorise). */
export async function addBonusDialog(actor, preset = {}) {
  const kinds = KINDS.map((k) => `<option value="${k}" ${k === (preset.kind ?? "forward") ? "selected" : ""}>${esc(t(`Kind.${k}`))}</option>`).join("");
  const exp = EXPIRES.map((k) => `<option value="${k}" ${k === (preset.expires ?? "roll") ? "selected" : ""}>${esc(t(`Expires.${k}`))}</option>`).join("");
  const content = `
    <p class="motwbt-form__who">${esc(actor.name)}</p>
    <div class="form-group"><label>${t("Form.label")}</label><input type="text" name="label" value="${esc(preset.label ?? "")}" placeholder="${esc(t("Form.labelPh"))}"></div>
    <div class="form-group"><label>${t("Form.kind")}</label><select name="kind">${kinds}</select></div>
    <div class="form-group"><label>${t("Form.value")}</label><input type="number" name="value" value="${preset.value ?? 1}" step="1"></div>
    <div class="form-group"><label>${t("Form.target")}</label>${targetSelect(actor)}</div>
    <div class="form-group"><label>${t("Form.qty")}</label><input type="number" name="qty" value="${preset.qty ?? 1}" min="0" step="1"><p class="hint">${t("Form.qtyHint")}</p></div>
    <div class="form-group"><label>${t("Form.max")}</label><input type="number" name="max" value="" min="0" step="1" placeholder="—"></div>
    <div class="form-group"><label>${t("Form.expires")}</label><select name="expires">${exp}</select></div>`;
  const data = await prompt(t("Form.addTitle"), content, t("Form.add"));
  if (!data) return;
  const tgt = parseTarget(data.target);
  const kind = data.kind;
  let expires = data.expires;
  if (kind === "forward" && expires === "never") expires = "roll";
  await addEntry(actor, {
    label: data.label?.trim() || t(`Kind.${kind}`),
    kind,
    value: Number(data.value) || 0,
    stats: tgt.stats,
    moves: tgt.moves,
    qty: ["pool", "hold"].includes(kind) ? Number(data.qty) || 0 : 0,
    max: Number(data.max) || null,
    expires,
    active: true
  });
}

/** Ajout rapide pour toute l'équipe. */
export async function addToAllDialog() {
  const exp = EXPIRES.map((k) => `<option value="${k}">${esc(t(`Expires.${k}`))}</option>`).join("");
  const content = `
    <div class="form-group"><label>${t("Form.label")}</label><input type="text" name="label" placeholder="${esc(t("Form.labelPh"))}"></div>
    <div class="form-group"><label>${t("Form.kind")}</label><select name="kind">
      <option value="forward">${esc(t("Kind.forward"))}</option><option value="ongoing">${esc(t("Kind.ongoing"))}</option></select></div>
    <div class="form-group"><label>${t("Form.value")}</label><input type="number" name="value" value="1" step="1"></div>
    <div class="form-group"><label>${t("Form.expires")}</label><select name="expires">${exp}</select></div>`;
  const data = await prompt(t("Form.allTitle"), content, t("Form.add"));
  if (!data) return;
  for (const a of trackedActors()) {
    await addEntry(a, { label: data.label?.trim() || t(`Kind.${data.kind}`), kind: data.kind, value: Number(data.value) || 0, expires: data.kind === "forward" && data.expires === "never" ? "roll" : data.expires });
  }
}

/** Donner un bonus à un autre chasseur (Prêter main-forte, Mettre une raclée 10+, Augures…). */
export async function grantDialog(fromActor) {
  const others = trackedActors().filter((a) => a.id !== fromActor?.id);
  if (!others.length) return ui.notifications.warn(t("Notify.noOther"));
  const content = `
    <div class="form-group"><label>${t("Form.to")}</label><select name="to">${others.map((a) => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("")}</select></div>
    <div class="form-group"><label>${t("Form.value")}</label><select name="value">
      <option value="1">+1</option><option value="2">+2</option><option value="-1">−1</option></select></div>
    <div class="form-group"><label>${t("Form.kind")}</label><select name="kind">
      <option value="forward">${esc(t("Kind.forward"))}</option><option value="ongoing">${esc(t("Kind.ongoing"))}</option></select></div>
    <div class="form-group"><label>${t("Form.reason")}</label><input type="text" name="label" placeholder="${esc(t("Form.reasonPh"))}"></div>
    <p class="hint">${t("Form.grantHint")}</p>`;
  const data = await prompt(t("Form.grantTitle"), content, t("Form.grant"));
  if (!data) return;
  const target = await fromUuid(data.to);
  if (!target) return;
  const who = fromActor?.name ?? game.user.name;
  await addEntry(target, {
    label: data.label?.trim() ? `${data.label.trim()} (${who})` : t("Form.grantDefault", { who }),
    kind: data.kind,
    value: Number(data.value) || 1,
    expires: data.kind === "forward" ? "roll" : "scene",
    source: "grant"
  });
  ui.notifications.info(t("Notify.granted", { who: target.name, value: sign(data.value) }));
}

/** Dépense de points : combien, et sur quoi. */
export async function spendDialog(actor, source) {
  const fixed = source.derived && (source.stats?.length || source.moves?.length);
  const maxN = source.derived ? source.max ?? 3 : Math.min(Number(source.qty) || 0, source.max || Infinity);
  if (maxN <= 0) return;
  const options = Array.from({ length: Math.min(maxN, 10) }, (_, i) => `<option value="${i + 1}">${sign(i + 1)}</option>`).join("");
  const content = `
    <p class="motwbt-form__who">${esc(source.label)}${source.cond ? ` — <em>${esc(source.cond)}</em>` : ""}</p>
    <div class="form-group"><label>${t("Form.amount")}</label><select name="amount">${options}</select></div>
    ${fixed ? "" : `<div class="form-group"><label>${t("Form.on")}</label>${targetSelect(actor)}</div>`}
    <p class="hint">${t("Form.spendHint")}</p>`;
  const data = await prompt(t("Form.spendTitle"), content, t("Form.engage"));
  if (!data) return;
  await spendPool(actor, source, Number(data.amount), data.target ?? "any");
}
