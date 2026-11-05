# Monster of the Week – Suivi des bonus

*[English below](#english)*

Module Foundry VTT (v13 / v14) pour le système **PbtA** : il suit tous les bonus des chasseurs de *Monster of the Week* (+1 forward, +1 continu, bonus constants, réserves, points à dépenser) et **les ajoute automatiquement au résultat des jets**.

Conçu pour fonctionner avec [FVTT-motw-for-ptba](https://github.com/Hancholito/FVTT-motw-for-ptba) (éditions FR et EN), mais utilisable avec n'importe quelle table PbtA pour les bonus ajoutés à la main.

## Installation

Dans Foundry : *Modules complémentaires → Installer un module*, puis coller l'URL du manifeste :

```
https://github.com/Hancholito/FVTT-motw-bonus-tracker/releases/latest/download/module.json
```

Activer **Monster of the Week – Suivi des bonus** dans le monde. `lib-wrapper` est optionnel.

## Ce que ça fait

### Panneau des bonus (joueurs et MJ)
Un panneau flottant, toujours au premier plan dans Foundry, déplaçable et repliable (raccourci **Maj+B**). Il montre :

- **Prochain jet** : le total qui s'ajoutera à n'importe quel jet, plus le nombre de bonus ciblés (sur une caractéristique ou une manœuvre) ;
- **Engagé** : ce qui s'appliquera au prochain jet concerné ;
- **Disponible** : les bonus sous condition issus des manœuvres du chasseur (à cocher quand la condition est remplie), les manœuvres qui donnent un forward (bouton *Prendre*) et les points à dépenser (bouton *Dépenser* : on choisit combien et sur quoi) ;
- **Réserves et points** : réserves (*hold*) affichées à titre indicatif, et points à dépenser attribués par le MJ ;
- **Autres effets** : dégâts, armure, caractéristiques déjà intégrées à la fiche, pour mémoire.

Le bouton ♥ permet de **donner un bonus à un autre chasseur** (Prêter main-forte, Mettre une raclée 10+, Augures…).

### Au moment du jet
Les bonus engagés sont ajoutés à la formule (`2d6 + Futé + 1 + 1…`) et détaillés dans le message de chat. Si un bonus est engagé ou disponible pour ce jet, la fenêtre de jet s'ouvre avec un **rappel** : on peut cocher ou décocher au dernier moment. Les forwards sont consommés, les bonus « ce jet » sont désengagés.

### Fenêtre MJ
Depuis le panneau (icône tableau) ou `game.modules.get("motw-bonus-tracker").api.openTracker()` :

- tous les personnages joueurs, avec leurs bonus attribués et ceux issus de leurs manœuvres ;
- ajout rapide (+1 forward, +1 continu), ajout détaillé (type, valeur, cible, quantité, expiration), bonus à toute l'équipe ;
- **Fin de scène** et **Fin de session** retirent ce qui expire ;
- historique des derniers mouvements par personnage.

### Types de bonus
| Type | Effet |
|---|---|
| Forward | S'ajoute au prochain jet correspondant, puis disparaît |
| Continu | S'ajoute tant qu'il est actif (interrupteur), jusqu'à son expiration |
| Constant | S'ajoute toujours aux jets correspondants |
| Points à dépenser | Le joueur choisit combien en engager, et sur quoi |
| Réserve | Compteur indicatif, pas de bonus au jet |
| Note | Mémo (ex. +1 dégât contre les fantômes) |

Une cible peut être *tout jet*, une **caractéristique** (Calme, Dur, Charme, Futé, Étrange) ou une **manœuvre** précise.

### Manœuvres reconnues
Une table de correspondance couvre 54 manœuvres des livrets (édition cartonnée et *Tome of Mysteries*) : Conduite, Contrariant, Je connais ma proie, Encaisser, Mystique, Augures… Les manœuvres sont reconnues par leur origine dans le compendium (les deux éditions partagent les mêmes identifiants), ou à défaut par leur nom en français ou en anglais. Le module **ne décide jamais à la place du MJ** si une condition est remplie : c'est le joueur qui coche.

### Verrou honnête
Par défaut, les joueurs peuvent engager, dépenser, déclencher leurs manœuvres et donner un bonus à un autre chasseur, mais pas créer ni supprimer les bonus du MJ. Le réglage *Les joueurs peuvent créer des bonus* lève ce verrou. Donner un bonus à un autre chasseur passe par le MJ connecté.

## Réglages
- Afficher le panneau des bonus (par client)
- Rappel dans la fenêtre de jet
- Bonus des manœuvres de base
- Les joueurs peuvent créer des bonus

## Notes techniques
Le module s'accroche à `ItemPbtA#roll`, `ActorPbtA#_onRollStat` et `RollPbtA#configureDialog` / `#configureModifiers` du système PbtA. Tout est regroupé dans `scripts/roll.mjs` : si une mise à jour du système casse les jets, c'est le seul fichier à adapter. Les données vivent dans les drapeaux des personnages (`flags.motw-bonus-tracker`) : désactiver le module ne touche à rien d'autre.

Module non officiel et gratuit. *Monster of the Week* est © Michael Sands / Evil Hat Productions.

---

## English

Foundry VTT module (v13 / v14) for the **PbtA** system. It tracks every *Monster of the Week* hunter bonus (+1 forward, +1 ongoing, constant bonuses, hold, spendable points) and **adds them automatically to roll results**.

- **Bonus panel**, always on top inside Foundry, draggable and collapsible (**Shift+B**): what is engaged, what is available from the hunter's moves, spendable points (choose how many and on what), hold, and other effects (harm, armour).
- **At roll time**: engaged bonuses are added to the formula and listed in the chat card; a reminder in the roll window lets you adjust at the last moment.
- **GM tracker**: every player character, quick and detailed bonus creation, team-wide bonuses, end of scene / session cleanup, history.
- **Recognised moves**: 54 playbook moves (hardcover and *Tome of Mysteries*) mapped to their bonuses, matched by compendium origin (FR and EN editions share IDs) or by name.
- **Honest lock**: players can engage, spend, trigger and give bonuses to other hunters; only the GM creates or deletes, unless the setting allows it.

Manifest: `https://github.com/Hancholito/FVTT-motw-bonus-tracker/releases/latest/download/module.json`

Unofficial, free module. *Monster of the Week* is © Michael Sands / Evil Hat Productions.
