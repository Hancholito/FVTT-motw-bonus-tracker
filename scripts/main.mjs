import { MODULE, registerSocket, endScope, addEntry, getEntries, computeForRoll } from "./store.mjs";
import { registerRollHooks } from "./roll.mjs";
import { render, scheduleRender } from "./hud.mjs";
import { BonusTracker } from "./tracker.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE, "hudEnabled", {
    name: "MOTWBT.Settings.hudEnabled.name",
    hint: "MOTWBT.Settings.hudEnabled.hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => render()
  });
  game.settings.register(MODULE, "forceDialog", {
    name: "MOTWBT.Settings.forceDialog.name",
    hint: "MOTWBT.Settings.forceDialog.hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE, "showBasicMoves", {
    name: "MOTWBT.Settings.showBasicMoves.name",
    hint: "MOTWBT.Settings.showBasicMoves.hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => scheduleRender()
  });
  game.settings.register(MODULE, "playersCanAdd", {
    name: "MOTWBT.Settings.playersCanAdd.name",
    hint: "MOTWBT.Settings.playersCanAdd.hint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => scheduleRender()
  });
  game.settings.register(MODULE, "hudState", { scope: "client", config: false, type: Object, default: {} });

  game.keybindings.register(MODULE, "toggleHud", {
    name: "MOTWBT.Keys.toggleHud",
    editable: [{ key: "KeyB", modifiers: ["Shift"] }],
    onDown: () => {
      game.settings.set(MODULE, "hudEnabled", !game.settings.get(MODULE, "hudEnabled"));
      return true;
    }
  });
});

Hooks.once("setup", () => {
  if (game.system.id !== "pbta") return;
  registerRollHooks();
});

Hooks.once("ready", () => {
  if (game.system.id !== "pbta") {
    console.warn(`${MODULE} | ce module nécessite le système PbtA.`);
    return;
  }
  registerSocket();
  const api = {
    tracker: null,
    openTracker() {
      if (!game.user.isGM) return;
      api.tracker ??= new BonusTracker();
      api.tracker.render({ force: true });
    },
    render,
    endScene: () => endScope("scene"),
    endSession: () => endScope("session"),
    addEntry,
    getEntries,
    computeForRoll
  };
  game.modules.get(MODULE).api = api;
  render();

  const rerender = (doc) => {
    const actor = doc?.documentName === "Actor" ? doc : doc?.parent;
    if (!actor || actor.type === "character") scheduleRender();
  };
  Hooks.on("updateActor", rerender);
  Hooks.on("createItem", rerender);
  Hooks.on("updateItem", rerender);
  Hooks.on("deleteItem", rerender);
  Hooks.on("createActor", rerender);
  Hooks.on("deleteActor", rerender);
  Hooks.on("updateUser", () => scheduleRender());
  Hooks.on("controlToken", () => game.user.isGM && scheduleRender());
});
