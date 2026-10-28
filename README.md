# League Macro Learner

A lightweight, turn-based web game for practicing **macro decision-making in League of Legends**: lane priority, rotations, objective control and map awareness.

> Status: playable vs-AI prototype. The rules below are still a draft and will be tuned through playtesting.

![Game screen](docs/screen.png)

## Getting started

Requires [Bun](https://bun.com/).

```sh
bun install          # install the workspaces
bun run fetch-data   # optional: refresh champions and images from Data Dragon (outputs are committed)
bun run dev          # dev server, prints the URL to open
bun test             # engine, data and web tests
bun run typecheck    # TypeScript strict, all packages
bun run check-deps   # enforces the module boundaries (see Architecture)
bun run build        # static site in packages/web/dist
```

CI runs typecheck, check-deps, tests and build. For screenshots, the app (any build) accepts `?autostart=1&rank=gold&seed=42` to skip the start screen and launch a game directly (on round 0's placement).

## The idea

Each team is five tokens on a simplified Summoner's Rift: top, jungle, mid, ADC and support. Every turn, both sides secretly give an order to each of their five tokens, then the turn resolves at the same time for everyone, like simultaneous-move chess.

> *Recall top, jungle takes Herald, mid rotates to Herald, bot lane shifts mid.*

The goal is to learn to read the board: who has lane priority, who can rotate first, and which objective is worth contesting.

## Tempo

Tempo is the heart of the game. **Every round is a unit of time, and the team that wastes fewer rounds wins.**

- **Priority is tempo.** A laner who has pushed their wave is free to move this round. Their opponent has to stay and catch the wave, or lose gold and XP.
- **Every action has a time cost.** A recall, a death or a long walk across the map costs rounds. Recalling right after shoving a wave costs almost nothing, while recalling with the wave pushed in front of your tower costs a lot.
- **Arriving first wins.** When both teams move toward the same objective, the side that gets there first, or with more tokens, takes the fight or the objective.
- **Converting tempo.** A tempo lead only matters once you spend it on something: an objective, a tower, an invade or vision.

Teaching mode calls out tempo directly, for example: *"You lost 2 rounds: your mid recalled without pushing the wave."* *(design call)* These tempo costs come from a rule table in data (situation → rounds lost + explanation), checked against the round's events, not from simulating alternative plays.

## Core rules (draft)

- **Random draft.** Each game starts with a random draft of real champions for both teams.
- **Matchups matter.** Each lane matchup gives an advantage that changes across five stages of the game: *really early, early, mid, mid-late, late*. That advantage drives lane priority.
- **Map positions.** The map has 39 positions: each lane tower (T1, T2, T3) and lane middle, every jungle camp, the Baron and Dragon pits, both Scuttle Crabs, and the two bases. They are placed from real Summoner's Rift coordinates, on top of the official minimap from CommunityDragon.
- **Rounds.** A round is resolved once you have given and confirmed an order for each of your five champions.
- **Phases.** Neutral objectives (Scuttle Crab, Dragons, Voidgrubs, Herald, Baron) set the rhythm. The game is split into phases, and every round lasts 20 s, so the phases only differ in what is on the map. Most of the advantage is decided before 25 minutes, so a game stops at 25:15, after 73 rounds (round 1 starts at 0:55, when the first monsters spawn).

| Phase | Game time | Round length | Rounds | Key events |
|---|---|---|---|---|
| 1. Level 1 & first clear | 0:55 → 2:55 | 20 s | 6 | lane priority, invades, end of first clear |
| 2. Scuttles & first Dragon | 2:55 → 6:15 | 20 s | 10 | Scuttle Crabs, first Dragon, Voidgrubs spawn |
| 3. Voidgrubs & plates | 6:15 → 14:15 | 20 s | 24 | Voidgrubs, Dragons, tower plates |
| 4. Héraut & mid game | 14:15 → 20:15 | 20 s | 18 | plates drop, Herald, T1/T2 towers |
| 5. Baron | 20:15 → 25:15 | 20 s | 15 | Baron, Dragon Soul, T2/inhibitor towers |

Every round is 20 s, so a token moves the same distance all game. Values that only make sense in real time keep their duration (the death timer and the Baron buff, below); the others count in rounds. Objective timers change between patches, so they live in data files.

- **Verdict.** There is no nexus to destroy for now. At the end of the game, the winner is the team with the bigger accumulated advantage: gold, objectives and towers.
- **Starting state (round 0, placement).** Before round 1, round 0 covers the start of the game up to 0:55. Each side puts each of its 5 champions on any position of its own side (its towers, its camps, its base) or on a lane middle (top, mid or bot); the river (Scuttles, pits) and the enemy side are not allowed, and several champions may share a position. The defaults are laners on their own T1 and the jungler on the Blue Buff or Red Buff picked by the seed; the AI keeps them. Nothing resolves in round 0: no contact, no farm, and no camp, since none is up before 0:55. In round 1, every champion placed on a camp (any role) clears it at the start of the round, before moves, wherever it then moves: that is its round-1 action, so it has no action on arrival (no second camp, farm or objective), and a laner placed on a camp gives up its round-1 farm. An enemy arriving on that camp finds it cleared; junglers clear first when two champions share a camp. Round 1 then starts with the usual vision, and each side sees where the enemy jungler started (its round 0 position) in round 1.
- **Death and recall.** A token that dies or recalls comes back next turn at a base position on its own half of the map. On that turn it can't invade or take an objective. A death keeps the champion out for a time that grows with the game stage (`death.roundsByStage`): 1, 1, 2, 3 and 6 rounds, which is 20 s, 20 s, 40 s, 1 min and 2 min. A recall always costs 1 round.

## Fights

**Contact.** A contact happens when enemy champions end the round in the same **zone**. Only the arrival position counts, so champions who cross paths during the round between two zones don't meet. The zones are:

- a **lane**: its towers (T1 to T3 of both sides) and its middle;
- a **river**: the top one is the top Scuttle and the Baron pit, the bottom one the bottom Scuttle and the Dragon pit;
- each **jungle camp** on its own.

Bases are never contacts.

**Standard laning** (even numbers in a lane, and all of them home laners of that lane: 1v1 tops, 2v2 bot duos) resolves automatically from the stances (see *Lane contacts* below). Every other zone with both sides present pauses the resolution, and each player involved chooses to **fight** or **flee**, with a default already selected: the smaller side flees, otherwise it fights. Against the AI, the AI answers for its side. A round therefore has two steps: give the orders, then answer the contacts.

| Situation | Kind | Default choice |
|---|---|---|
| Even numbers in lane, all home laners | Lane trade (automatic) | Each side's **stance**. See *Lane contacts* below. |
| Ganked (an enemy **arrives** in your lane this round from elsewhere and outnumbers you; a laner coming back to its own lane is not a ganker) | Gank | **Flee** (the gankers: **fight**) |
| Outnumbered in lane without a gank (e.g. the enemy support roamed away, so it is 2v1) | Lane pressure | **Flee** (the bigger side: **fight**) |
| Anything else in a lane (e.g. both junglers join a 1v1) | Skirmish | Smaller side flees, otherwise fight |
| Both sides in a river | Objective | Smaller side flees, otherwise fight. See *Neutral objectives*. |
| An enemy camp | Invade | The invader can only fight |

**Joining a fight 1 step away.** When a prompted contact happens (any kind above except the automatic lane trade), each champion of either side that is alive, in no contact, not recalling, and arrived 1 step (one graph link) from any of the contact's positions gets the choice **Rejoindre le combat** or **Rester** (the default). Both sides answer together with the contact's own choice: the prompt shows the contact with your possible joiners, never the enemy's (where an enemy ends its move is its hidden order; its joiners show in the log once the contact resolves).

- *(decision)* **No lane-to-lane join.** A champion that arrived in another lane (a tower or a lane middle of another lane) cannot join a lane contact, even 1 step away (a mid laner on its mid T1 cannot join a top lane fight). Joining a lane fight from the jungle or the river stays allowed, and so does joining a river or camp contact from a lane.
- A joiner walks its one step into the contact (onto the fight position when it is 1 step away, else onto the contact position next to it; a lane fight then pulls it in like everyone else) and fights with its side: numbers, fight scores, HP losses, deaths, 0 HP kills and the kill credit all include it, and it is seen there like every champion of the contact. If its side flees or loses, it flees or retreats with it.
- *(design call)* It **forfeits its own action** this round (no camp clear, no farm, no objective elsewhere), and the log reads "… rejoint le combat à … (depuis …, sans action)" ("depuis …" only when you see where an enemy joiner came from).
- *(design call)* A champion near several contacts is offered each but joins one at most: choosing one leaves the other (in the engine, the first contact in id order it is given for).
- *(design call)* In a lane, the contact's kind follows the new numbers: a joiner from outside the lane making its side the bigger one turns it into a **gank** (a laner joining in its own lane is not a ganker), even numbers make it a **skirmish**. The choices offered and the fight position stay as prompted. A river or camp contact keeps its kind.

**Where the fight happens.** On the position of the smaller side (the one with most of its champions if they are spread), or with even numbers on the zone position holding the most champions; remaining ties never favour a side: in a lane, the tied position closest to the lane middle wins, and the lane middle itself when two are as close (one champion on each T1 fights in the middle, with no tower); in a river, the pit wins over the Scuttle. In a lane, when nobody flees, every champion of the contact is moved onto that position, and a standing tower there counts for its defenders. Being moved there neither gives nor takes an action: a champion acts there only if it had a step left on arrival. *(design call)* Automatic lane trades and river contacts move nobody: in a river, each champion stays on the pit or the Scuttle it arrived on, except on a tied fight (everyone ends on the fight position) and on a flee (see *Flee*).

**Staying under your tower.** In a lane, a smaller side whose champions all stand on their own standing tower may also choose **farm**: it stays and farms at `economy.pressureFarmShare` (half) of a normal round. If the bigger side fights, each of them loses `fight.pressureHpLoss` (10) HP, and they die only if the bigger side wins by more than `aiTuning.allInMargin`. When the contact is a gank and the gankers win with no kill, the failed-gank rule applies instead (below): `fight.gankHpLoss` (50) HP each and the wave goes to the tower or a plate is taken.

- **Flee**: the champion survives and takes **one step toward its own base from where the contact happened**, or from where it stood if that is closer to its base (a flee never moves a champion toward the enemy): along its lane to the next own tower (mid lane → own T1, T1 → T2 → T3 → base), elsewhere (jungle, river) to the neighbouring position closest to its base. *(design call)* After choosing Fuir, the player may instead click, per fleeing champion, one position 1 step from the spot it flees from: any neighbour except the contact's positions, the enemy base and every position an enemy of the contact came from this round (the automatic step is always allowed). Without a click, the automatic step applies; the AI always takes it. Fight losers and the loser of an objective race always retreat automatically. A picked step changes nothing else: still no action, the same HP cost, and no new contact. It no longer defends the tile it left. On an objective, it gives the objective up. A champion who flees or retreats **forfeits its action** this round: no camp, no Scuttle or objective, no farm. So does a champion whose recall a fight interrupted.
- An outnumbered side that flees a side that fights loses `fight.fleeHpLoss` (15) HP, or `fight.gankHpLoss` (50) when it is the ganked side of a gank.
- **A gank with no kill** (the gankers win the fight and nobody dies, or the ganked side flees) costs each surviving ganked champion `fight.gankHpLoss` (50, half of `health.max`) and moves that lane's wave straight to the ganked side's tower, instead of the lane's normal wave move. If the wave is already there, the gankers take a plate instead: 1 damage on the ganked side's front tower in that lane, with plate gold before 14:00 like any plate (after it the damage still applies, with no gold). Once per lane and round. A gank that kills does neither.
- **Fight**: the winner takes the kill. Losers **die**. On a pit objective, only a side that chose to keep taking it takes it (see *Neutral objectives*).
- If both sides flee, nobody takes the objective and it stays up for the next round. If one side flees and the other keeps taking the objective, that side takes it without a fight.
- *(design call)* In lane, if one side flees and the other trades or fights, the side that stayed wins the trade (wave and lead).

**Lane pressure without a gank.** When a lane is uneven and nobody arrived from elsewhere (for example someone left it, or a laner walked back to its own lane), the contact is prompted like a gank, but the ganked side's exposure plays no part. The bigger side pushes the wave and hits the tower (plates). A smaller side that stays to farm under its tower farms at a reduced share (see *Staying under your tower*).

**Lane stance.** Each laner has a persistent **stance**, set once in its actions and kept until changed: **Farm** (default), **Trade** or **All-in**. Even lane contacts resolve automatically from both stances, with no prompt each round. The game only asks for a choice outside standard laning: a gank, an outnumbered lane, a skirmish, a contested river, an invade.

**Laners follow their wave.** A laner with no order stays in its lane on Farm (safe), and follows its lane's wave automatically: it stands where the wave is (in front of its tower, in the middle, or in front of the enemy tower) and farms.

**Lane pressure is computed.** Each lane's pressure comes from the matchup, the levels and the lead of the laners present. It pushes the wave. The map shows it as an arrow, which is **your estimate**: your champions as they are, and the enemies you see with the stats you would estimate for them (see *AI opponent*), never their true lead.

**Lane contacts.** With even numbers in lane, each side's stance decides, with no prompt. A stance is one of:

- **Push**: shove the wave: it moves one extra step toward the enemy tower and hits it harder, but the laner stands forward and is more exposed to ganks. In a lane contact it behaves like Farm (no all-in).
- **Farm** (default): play the lane normally, with no trade. The wave moves by matchup and lead, as when the laners don't meet.
- **Trade**: exchange spells without going for the kill. Nobody dies. The trade winner (fight score) gains lead and pushes the wave.
- **All-in**: go for the kill, which turns the contact into a fight where the losers die.

**Flee** is not offered on these automatic even-lane contacts: the stances decide. To leave the lane, give the laner another order.

Nobody can die in lane unless at least one side picks **All-in**, and a laner on **Farm plays safe**: in an even lane contact (1v1, 2v2) it never dies, even against All-in. The All-in side only wins the trade (wave and lead). Only a laner on Trade or All-in can be killed in an even lane. Ganks and outnumbered lanes stay dangerous. Farm against Trade is a trade. The AI only goes all-in with a large advantage (threshold in data).

**Invading** enemy jungle is a commitment, with no option to flee. If you meet an enemy and lose the fight, you die.

**Towers in a dive.** A fight on a position with a standing tower counts that tower as an extra **weak champion** on the defending side.

**Who wins.** Fights are **deterministic**: the same situation always gives the same result. In order of weight:

1. **Numbers**: the side with more champions has the upper hand, especially in early game.
2. **Lead**: a per-champion gauge of XP and gold, updated each round.
3. **Matchup**: the advantage of one champion against another, which depends on the game stage.
4. **Skirmish strength** or **teamfight strength**: a per-champion value that also depends on the game stage. A fight with **7 or more champions in total** (4v3 or bigger) is a teamfight. Anything smaller, up to 3v3, is a skirmish.

Game stages for matchups, skirmish and teamfight: *really early, early, mid, mid-late, late*.

**How the factors combine** *(design call, to tune in playtest)*. Each side gets a fight score, which is a weighted sum. Numbers carry by far the biggest weight, and that weight is highest in early game. Lead, matchup and skirmish or teamfight strength come after. In a fight with more than one champion per side, each matchup term is the average over the opposing champions that have a matchup row. All weights live in data.

- **The side with the higher score wins.** The **score gap** sets how many champions die on the losing side (`fight.deathGap` per death, data): a small gap can kill nobody, a large one kills everyone. The most wounded die first. Every losing survivor loses `fight.survivorLoss` (15) HP and every winner `fight.winnerLoss` (5), the same as a won trade. Winners gain gold and XP for each kill. Losers who survive a fight retreat (like a flee, one step toward their base), leaving the spot to the winners. **A champion whose HP reaches 0 from any loss (a trade, a flee, a gank) dies like a fight victim**: respawn timer, a kill and its gold and XP for the opponents in the contact that caused the loss (the other laners in a trade, the side that stayed after a flee or a gank), split like fight winners.
- **Ganks and lane position.** A ganked laner's position on its wave matters: pushed toward the enemy tower it is exposed (bonus to the gankers), in the middle it is neutral, under its own tower it is protected (the tower already helps the defenders). A gank that kills nobody still costs the ganked champions HP: in a fought gank they lose `fight.gankHpLoss` (50) instead of the survivor or winner loss (never both), while the gankers winning pay `fight.winnerLoss`.
- **On an exact tie**, nobody dies, each champion in the fight loses `fight.tieLoss` (10) HP (a ganked side too: `fight.gankHpLoss` is for decided fights only), and both sides stay where the fight happened, with no action this round (a recall is cancelled, a camp is not cleared).

**HP is visible.** Every HP loss shows in the log (yours, and the enemies you see after the round). A champion who lost HP this round does not regenerate at its end.

**A contact is vision.** Meeting in a contact, each side sees the other's champions there: every contact prompt shows the HP of all the champions in it, and the AI chooses with the same HP. Out of a contact, an enemy you don't see is assumed at full HP.

## Lanes and towers

**Waves.** Each lane has a wave position: near the blue tower, in the middle, or near the red tower. The wave state is **deterministic**, like a fight:

- When both laners stay in lane, the matchup and the lead decide where the wave goes.
- When one side gets more champions in the lane, the wave is pushed.
- When a laner leaves their lane, their wave pushes toward their tower and the enemy laner gains lead. If that enemy also had matchup pressure, the tower loses some HP.
- *(design call)* "Near the tower" always means the side's **frontmost standing tower** in that lane. When a T1 falls, the wave fights at the T2.

**Towers.** Each tower has **5 HP**, and one HP is one plate.

- Each round of pushing on a tower removes HP based on how many champions push it:

  | Champions pushing | 1 | 2 | 3 | 4 | 5 |
  |---|---|---|---|---|---|
  | HP removed | 1 | 1 | 2 | 3 | 4 |

- The **Herald** removes **3 HP**.
- *(design call)* A tower only takes damage when the attacking side's wave is near it and at least one attacker is on its position. Defenders on the position fight the attackers first.
- *(design call)* There are no inhibitors or nexus as targets in this version, since the game stops at 25:15.
- **Voidgrubs** and **Baron** multiply tower damage (see [Neutral objectives](#neutral-objectives)).
- Plates give gold until 14:00.
- *(design call)* Tower damage, pushing bonuses and plate chips are per round, tuned for 20 s rounds, and rounds are now 20 s all game: late-game towers fall faster in minutes than with longer rounds.

## Neutral objectives

| Objective | Reward |
|---|---|
| **Scuttle Crab** | Gold for the champion who takes it, plus a **Scuttle ward** on the Scuttle's own position, which also sees the nearby pit (Dragon for the bottom Scuttle, Baron for the top one). It already gives vision at the end of the round the Scuttle is taken (a normal ward only from the next round), then lasts like a normal ward, never counts toward the 3-ward limit, and replaces only your previous Scuttle ward on that Scuttle. |
| **Dragon** | Lead for the whole team |
| **Voidgrubs** | Tower damage ×1.5 for the team, for the rest of the game |
| **Herald** | Picked up by the champion who takes it, then launched on a tower in a later round to remove 3 HP |
| **Baron** | Tower damage ×2 for the team for 9 rounds (3 min) |

Tower damage bonuses stack: Voidgrubs plus Baron gives ×3. The Herald launch is an action the carrier picks at its tower position.

*(design calls, values in data)*
- Each objective has a minimum number of champions needed to take it. Starting values: 1 for Scuttle, Dragon, Voidgrubs and Herald, 3 for Baron.
- **Dragon, Voidgrubs, Herald and Baron take time.** You arrive on the pit one round and take the objective at the end of the next round, as long as you stay there with the numbers (below). With **4 or more champions** on the pit, Dragon, Voidgrubs and Herald are taken on arrival. Baron always takes the extra round, even with 5 champions. In between, the enemy has a round to contest it. The Scuttle Crab is taken on arrival.
- Neutral objectives follow the 2026 spawn timers (patch 26.1), stored in data: Scuttle Crabs 2:55 (respawn 2:30), Dragon 5:00 (respawn 5:00), Voidgrubs 8:00 (once, they leave at 14:45), Herald 15:00 (once, it leaves at 19:45), Baron 20:00 (respawn 6:00). The Voidgrubs, Herald and Baron share the Baron pit, each one replacing the previous.
- There is no Dragon Soul bonus. Each Dragon simply adds team lead.
- **The river is one grouped fight.** A champion with a step left on a pit starts or continues its objective. When the pit objective is taken, the river's Scuttle is taken in the same round if it is up and no enemy is in the river, shared by the same champions. A champion on the Scuttle takes only the Scuttle and never starts the pit objective. Any enemy anywhere in the river contests the Scuttle.
- **With the numbers on the pit.** After the river contact resolves (flees and retreats applied, the dead removed), a side progresses the pit objective when its champions on the pit with a step left, and that chose to keep taking the objective, outnumber every alive enemy still on the pit, acting or not. An uncontested side progresses as before. The same side progressing 2 rounds in a row takes it at the end of the 2nd round (4 or more champions still take Dragon, Voidgrubs and Herald in one round). Equal numbers: no progress, and the capture resets; when the numbers flip, the capture restarts for the other side. Baron still needs 3 champions. *(design call)* An enemy on the Scuttle is not on the pit: it contests the Scuttle, not the pit objective.
- **A contested river** offers each side **fight**, **flee**, and **keep taking the objective** (only to a side with a champion acting on the pit or the Scuttle, and only when that side knows of something to take: the pit objective is up or spawns this round, or the Scuttle is up as that side last saw it):
  - *objective* against *flee*: the objective (and the Scuttle) proceeds;
  - *objective* against *fight*: a fight where the objective side's score is multiplied by `fight.objectiveFocus` (0.8); if it still wins, it progresses the capture as usual (taken at the end of its 2nd round in a row, or at once with `instantAt`), as well as taking the kills;
  - *objective* against *objective*: a race. The higher fight score keeps taking it and the other side leaves; nobody dies or loses HP. On a tie, both stay, and the numbers on the pit decide: the bigger side progresses it, equal numbers reset it.
  - *fight* (won, or against *flee*): the winner takes the kills but does not start, continue or take the pit objective this round; a capture in progress is lost. A champion on the Scuttle with a step left still takes the Scuttle.
  - A champion arriving on its last step (no action left), or recalling, cannot choose the objective, but still fights.
- Jungle camps first spawn at 0:55 (Blue Buff, Red Buff, Wolves, Raptors) or 1:07 (Krugs, Gromp; `rules.camps.firstSpawnByCamp`). Krugs and Gromp spawn inside round 1 (0:55 → 1:15), so they count as up in that round, like an objective spawning in it. Camps respawn on their real timers (buffs 5:00, small camps 2:15) and give gold and XP to whoever clears them: one camp per round, the one the champion stands on with a step left (see [Movement](#movement)). Exception: in round 1, a champion placed on a camp clears that camp at the start of the round, wherever it moves, and has no action on arrival. `clearSpeed` no longer lets a jungler clear a second camp on the way. Clearing an enemy camp works like your own, and you then know its respawn timer.

## Lead, gold and recall

Each champion has a **lead gauge** made of two parts:

- **XP**: updated at the end of every round, from farming, kills and objectives.
- **Items**: gold piles up as you play, but it only turns into power when you **recall** and buy items.

*(design call)* The gauge is a single number: XP value plus the value of the items you own. Unspent gold is shown separately and only adds to the gauge on recall. Farming each round, kills, camps, plates and objectives all give XP and/or gold, with amounts in data.

**End-of-game verdict** *(design call)*: each team scores its gold (including the value of items) plus fixed values for each objective and each tower plate or tower. The values live in data. The higher score wins.

**Health.** Every champion has **100 HP**. A lost trade costs HP, the winner loses a little; so does a fight (winners 5, losers who survive 15, everyone 10 on a tie); a champion regains some HP every round, except a round in which it lost HP; a recall or a respawn restores full HP. A wounded champion weighs less in fights. Values live in data.

**Death.** A champion who dies also spends its unspent gold on items, as on a recall.

Recalling is how you **cash in** your advantage. A champion sitting on a lot of gold is weaker than its gold says until it goes back to base. Picking the right moment to recall is a tempo decision: it costs rounds, but it turns gold into strength.

**Recall after a move.** The recall is the round's action, so it needs a step left: in a 2-step round, a 1-step move then the recall, from where the move ends. A recaller whose step lands in a contact it flees recalls from where it fled to; a fight cancels the recall. In the actions panel, a pending move that leaves no step turns the Recall button off with its reason (*"Le recall demande un pas restant : déplacement d'1 pas au plus"*); a 1-step move then Recall reads "Déplacement puis recall". Picking a destination while a recall is pending keeps the recall when that destination leaves a step (your own position: a recall in place), otherwise the move replaces it and the panel says so. The log says where each recall happened.

## Movement

The map positions form a graph, and a move is a walk of a few steps on it. [`docs/movement-map.html`](docs/movement-map.html) shows it: click a position to see where a champion can go in one round, for each side. After changing the map or the movement rules, regenerate it with `bun run movement-map`. Starting values:

- **Step budget**: every champion, laner or jungler, has the same number of steps per round, 2 steps in a 20 s round (`rules.moves.budgetBySeconds`), all game long.
- **Speed boost from the base**: a move that starts on your own base gets 1 more step (`rules.moves.baseBonus`), respawns included. From the base, the T1s are 3 steps away (base → T3 → T2 → T1): a champion reaches its T1 without an action (2 steps plus the bonus leave none to act).
- **An action costs a step**: clearing a camp, taking a Scuttle, starting or continuing a pit objective, farming your lane's wave, and recalling all need a step left once you arrive. Staying where you are always leaves one.
- **Arrival only**: a position reached on the last step of the budget is reached, but nothing is done there that round. The champion still fights or flees there, and acts the next round by staying. For example, with 2 steps, a jungler going Wolves → Krugs (through the mid T1) arrives without clearing Krugs, and a laner arriving in its lane on its last step gets no farm that round.
- **Changing lane ends the move**: going from one lane to another is 1 step between the T1s (mid T1 → top or bot T1), the T2s (mid T2 → top or bot T2) or the T3s (any T3 → another T3 of its side), and the champion stops there for the round.
- **Along a lane**: T3 – T2 – T1 – lane middle – enemy T1, one step each. There is no shortcut from a T1 to the enemy T1.
- **Lane to river**: the top Scuttle and the Baron pit are 1 step from the top T1s, the top lane middle, the mid lane middle and the blue mid T1 (and the red mid T1, by symmetry); the Scuttle and the pit are 1 step from each other. The bottom side mirrors it. So the mid lane middle reaches both Scuttles and both pits, and so does each mid T1.
- **A Scuttle's pit is as close as the Scuttle**: whatever is 1 step from a Scuttle is also 1 step from the pit next to it (Baron pit for the top Scuttle, Dragon pit for the bottom one). This is a rule of the map loader, so a new Scuttle link brings its pit link with it.
- **River to jungle**: the top Scuttle and the Baron pit are 1 step from blue Gromp, Blue Buff and Wolves, and from red Raptors, Red Buff and Krugs. The bottom side mirrors it.
- **Your own jungle**: Gromp, Blue Buff and Wolves are each 1 step from the other two, and so are Raptors, Red Buff and Krugs. Wolves and Raptors are also 1 step from each other, a direct crossing over the mid lane that is not a lane change. Crossing to the other camps goes through the mid lane: Wolves → Krugs through the mid T1 or through Raptors.
- **Mid to buffs**: the mid T1 and the mid T2 of a side are each 1 step from that side's Blue Buff and Red Buff (and back). Not a lane change.
- **Jungle to lanes**: Gromp → top T2 and T1, Blue Buff → top T1, Wolves → mid T2, T1 and lane middle, Raptors → mid T2, T1 and lane middle, Krugs → mid T1, bot T2 and T1, Red Buff → bot T1 (the red side mirrors it), so a jungler ganks its nearby lane from an outer camp.
- **Route**: a move is drawn and resolved along a shortest path. Among equal ones, each step prefers a lane position, then a camp, then a Scuttle, then a pit (a champion only walks through a pit when no other shortest path exists).

- **Pit objectives** (Dragon, Voidgrubs, Herald, Baron) take one extra round, unless 4 or more champions are on them (except Baron, which always takes the extra round) (see [Neutral objectives](#neutral-objectives)).
- **Recall** is the action: it can follow a move that leaves a step of the budget (at most 1 step in 20 s rounds), and can place or clear a ward on the way, like a move (for example, step back under your tower, then recall). The champion recalls from where it ends, if it is not caught in a fight there, and leaves its base the next round, so a recall costs 1 round. Placing a ward is free: it costs no step.
- **Bases** are two more positions (Base blue and Base red), which brings the total to 39. A champion who respawns after death or recall starts its round on its base and moves from there with the base's extra step: it picks any position that move reaches (staying in base included), and acts there only with a step left. By default a laner goes to the frontmost standing tower of its lane, and a jungler to its nearest camp. A champion who flees on the round it leaves the base takes one step toward its base from the contact, like any other flee.

**Sacrificing a wave.** Leaving a lane while the wave crashes under your own tower costs the wave (gold, XP, possibly plates), but it can be the right play when it gives your team the numbers on a neutral objective. Teaching mode doesn't call this a mistake when the champion went to an objective that was up, about to spawn, or taken that round. It explains the trade-off instead, and higher AI ranks make this sacrifice when the objective is worth more than the wave.

These values live in data files and are a starting point, to be tuned through playtesting.

## Vision

Enemy champions are hidden in fog of war. You see an enemy champion only if it is:

- in the **same lane** as one of your champions, meaning any tower position or the middle of that lane,
- on the **same position** as one of your champions (a camp, a pit, a Scuttle…),
- on a position where you have a **ward**.

An enemy **recall** shows (log line and the recall icon in the replay) whenever you see the position it recalls from, ward vision included, even if you never saw the enemy itself.

Vision is revealed when the round resolves, so you use what you saw this round to plan the next one. The enemy jungler's starting position (its round 0 placement) is visible only during the first round.

**Met enemies.** Every champion in a contact that round (lane or jungle, prompted or automatic) is met by the other side. Until you see it again, its enemy card shows the level and HP it had when you met it, with where and when (`met`). Once seen again, the live values replace it. Fog of war holds otherwise.

**Camp timers.** You know a camp's respawn timer, yours or the enemy's, from the last time you saw it: with a champion or a ward on it, or by clearing it. An enemy clear you did not see leaves the camp shown as before.

**Wards**

- A champion can place a ward in addition to its move, **either on its starting position or on its arrival position** (the player chooses).
- Each team can place up to **3 wards per round**.
- A ward lasts **2 rounds** (`wards.duration`): placed in round N, it gives vision when rounds N+1 and N+2 resolve, then fades. Its marker shows the rounds it has left.
- **Spotting.** An enemy whose path this round (its start, every step and its arrival) crosses one of your active wards is reported in your log: *"Ward à {position} : {champion} repéré"*, with its arrival position this round (before any fight pulls it, or it flees) when you see that position. A Scuttle ward taken this round spots only from the next round. Otherwise its last seen position becomes the last warded position on its path. Either way the enemy is **visible for the next order phase with its level and HP**, like an enemy seen at the end of the round (at its arrival when you see it, else on that ward position), though its moves stay hidden. This holds for every ward, the Scuttle ward included. An enemy standing still on a ward is simply visible. Only the ward's team gets the report.
- The **Scuttle ward** (see [Neutral objectives](#neutral-objectives)) shows on the dead Scuttle.
- First round: depending on their starting side, the jungler can place their ward at the **Blue Buff** or at the **Raptors**.

**Clearing wards**

- Only the **jungler** and the **support** can clear wards.
- Each team can clear **1 ward per round**, either on the champion's starting position or on its arrival position (the player chooses).
- A champion can place a ward and clear one in the same round, on the same position or not.
- **Dewarding reveals.** An enemy who clears one of your wards is visible to you that round, at the ward's position (or where it ends, if you see it), with its level and HP. Your log names it: *"Ward bleu détruite à {position} par {champion}"*.

## Game screen

- **Start screen**: AI rank, teaching mode and seed. **Lancer la partie** opens round 0.
- **Round 0 (placement)**: the usual game screen, with "Round 0/73 · placement" and 0:00 in the score bar. Click one of your champions: every allowed start position lights up (no step budget), and a click on one puts it there (on a token too, to share its position). The round summary lists where each champion starts. Round 0 is simultaneous: no enemy is shown while you place, and the AI's placement applies when you validate. **Valider le placement** (in the score bar and the round summary; **Enter** does the same) starts round 1's orders.
- **Quitter la partie**: in the middle of the score bar on every game screen. It asks inside the page, "Quitter la partie ? Oui / Non" (never a browser dialog); **Oui** drops the game and goes back to the start screen, **Non** keeps it.
- **Score bar** (very top, across the page, like a competitive match broadcast): your team (blue) on the left, the enemy (red) on the right, mirrored. Per team, from the outside in: towers destroyed, plates, Voidgrubs, Heralds, Dragons and Barons taken, the total **gold earned** (with the gold difference, "+1,2k", on the side ahead), and the kills, large, next to the middle. The middle holds the game clock (the round's start; the round's window in the tooltip), round N/73 and the phase, the AI rank and seed, the round's buttons and **Quitter la partie**: **Valider le placement** in round 0, **Valider le round** while you give orders (**Enter** does the same when no field or button has the focus), so confirming never needs a scroll. Kills, towers, plates and objectives are public, as in a broadcast. Gold earned is a learning aid and uses the enemy's real gold. It also feeds the estimates of enemies you can't fully see: the AI, the pressure arrows and the strength bars size an enemy on your own champion of the same role, with its items scaled by the gold ratio (see *AI opponent*). On narrow screens the middle takes its own row above the two teams.
- **Teams on the sides, like League**: your team in a column left of the map, the enemy team in a column right of the map. One card per champion with role icon, name, level, XP bar, lead bar and unspent gold (own team), or where it was last seen (enemy): "Vue : … (ce round)", "Croisé : … (round N)" when you met it in a contact and have not seen it since (with the level, HP and estimated power it had then), "Dernière vue : … (round N)" or "Jamais vu". The team headers keep gold earned, XP, wards used and the objective score; Voidgrubs and plates moved to the score bar.
- **Above every visible token**: its HP bar, its power score (level and lead), its level and its XP bar, so you can compare yourself with a visible enemy. The team cards show the same, plus unspent gold for your own champions.
- **Center**: a flat map showing every playable position, with a tooltip on hover. One token per champion, with the official League role icon above it (from CommunityDragon) and its name below. Fog of war covers what you can't see. The map takes the full available height, and every position and token has a click target larger than its drawing.
  - Each pit names what it counts down to and when it spawns: on the Baron pit "Larves 7:05" at 0:55 (the time left, like every other timer), then "Héraut" and "Nashor" with their time left; on the Dragon pit "Dragon 4:05" (the SVG title also gives the spawn time). While up, and already in the round it spawns in (it spawns at the start of the resolve, but the order phase counts it up, as contacts do), the pit shows "Larves en vie" and, for the Voidgrubs and the Herald, the time left before they leave the pit ("part dans 6:50"). Each Scuttle and jungle camp shows the time left before it spawns, or that it is up. While a capture is in progress (yours, or the enemy's once you see it), the pit shows who takes it and the rounds left: "Dragon — Bleu, 1 round restant" (a capture completes at the end of its 2nd round in a row). A cleared camp is greyed out with its respawn timer. This includes the enemy's camps whose timers your side knows.
  - Each lane shows its **wave** marker (near the blue tower, in the middle or near the red tower), so you can read lane priority.
- **Actions** (a small panel next to the selected token, opened on the side where it hides the fewest positions, and **draggable** by its title; it keeps its position between rounds): the selected token's options, including a laner's stance. Place a ward or clear one, each on the starting or arrival position. Recall, in place or after a step that leaves a step of the budget for it ("Déplacement puis recall"). The panel shows the round's range ("Portée : N pas, une action coûte un pas").
- **Objective prompt**: at the start of the order phase, each of your champions standing on a pit, or whose pending move ends on one with a step left to act, whose objective is up, being taken or spawning by the end of the round (Dragon in round 13, Voidgrubs in round 22) gets a prompt docked on the map: "Faire le Dragon" (plus " + Carapateur" when the river's Scuttle is up), which gives a stay order (a pending move onto the pit is kept), or "Autre ordre", which selects the token. It shows once per champion and round.
- **No-order indicator**: during the order phase, an alive champion of yours with no pending order whose default is to stay where it is gets an amber "?" badge on its token and a "? Sans ordre" tag on its team card, and the round summary lists them ("Sans ordre : Vi, Galio"). A laner in its home lane follows its wave and is not flagged (the summary says "suit sa wave"), nor is a respawning champion (it has a default spawn).
- **Round summary** (below the map): current phase, round and game time, next objective spawn, the list of this round's orders, the **Confirm round** button, and teaching-mode explanations after the round resolves.
- **Contact prompts**: when a contact needs an answer during resolution, the choices appear in an overlay docked on the map, next to the contacts. Each prompt is titled by its zone ("Lane top", "Rivière haut (Carapateur + Nashor)", or the camp's name), lists the zone positions involved and the HP of every champion in it, and rings each of them on the map. The choices are Combattre (All-in on an even lane contact), Fuir, "Farmer sous la tour" (plain "Farmer" on an even lane contact) and, on a contested river, "Continuer l'objectif". Only a side that picks "Continuer l'objectif" progresses the pit's objective, and a recalling champion is never offered it. When offered, "Continuer l'objectif" is preselected; otherwise the contact's default is. Below the choices, each of your champions 1 step away from the contact gets **Rejoindre le combat** / **Rester** (default), noted "rejoindre = pas d'autre action ce round"; a champion near two contacts joins one at most. The enemy's possible joiners are never listed. After Fuir, each of your champions in the contact shows where it flees ("Fuite : 1 pas vers ta base (auto)", or "Fuite vers {position}"); **Choisir sur la carte** (on by default for the first one right after picking Fuir) highlights its allowed steps on the map, and a click on one picks it ("Fuite auto" goes back to the automatic step).
- **After a round resolves**, the score bar's button becomes **Round suivant**, with **Revoir le tour** below it.
- **Ward markers**: an eye icon on every position where your team has a ward, with the rounds it has left (from the engine's ward timing) and its expiry round in the tooltip. The Scuttle's ward sits on the dead Scuttle, with the tooltip "Ward du Carapateur".
- **Round replay**: after a round resolves, a short animation (about 2 s, with replay and skip buttons) plays it on the map: visible tokens slide to their destination along their route, fights flash, deaths and taken objectives appear. A recalling token shows the recall icon and fades out at the end, after its step if it had one; an enemy recall you saw only through its position (a ward) shows the icon there. When a ward spots an enemy, its eye pulses and a dashed ghost of the enemy flashes there, without revealing anything the ward didn't see. Only what you saw is shown.
- **Log** (below the map): one line per event. A move onto a camp and its clear read as one line ("… se déplace vers … et tue le camp"). An arrival on the last step reads "… arrive à … (sans action)". HP lost reads "… −N PV", a taken objective reads with its article ("Rouge prend les Larves à …", "le Héraut", "le Nashor", "le Dragon", "le Carapateur"), a ward spotting reads "Ward à … : … repéré → …", and a champion joining a fight 1 step away reads "… rejoint le combat à … (depuis …, sans action)" (the replay slides it onto the fight).
- **Giving orders**: click a token, and only the positions it can reach this round light up. Positions where it can still act on arrival are yellow. Positions it reaches on its last step have a dashed ring and the tooltip "Arrivée seulement : pas d'action ce tour". Then click its next position. A dashed arrow shows the move along the engine's route; a recall after a step ends its arrow in the recall icon, and a recall in place shows the icon on the token. With no order, a laner standing in its home lane follows its wave; any other token stays where it is.

The clickable mockup [`docs/game-screen-mockup.html`](docs/game-screen-mockup.html) is the reference for this layout. It also holds the first draft of the position coordinates and the movement graph.

## Game modes

1. **vs AI.** A full game against a computer opponent. This is the first mode to build.
2. **vs human.** Two players give their orders simultaneously.
3. **Puzzles.** A preset mid-game situation where you have to find the winning play.
4. **Sandbox.** Set up any situation by hand: pick each champion, place it on any position, and set levels and advantages. It is meant for coaches, who can use it to explain a situation and then play it out.

**Teaching mode** can be turned on or off. When it is on, the game explains each turn's outcome, for example: *"The enemy mid had priority and rotated to Scuttle first, so it became a 2v1."*

## AI opponent

There are **10 difficulty levels**, named after League ranks: Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster, Challenger.

The AI always plays by the fog-of-war rules: it only knows what its own wards and champions see, plus the public scoreboard. For an enemy, it assumes the XP of the enemy's seen level, or else of its own champion of the same role, and that champion's items scaled by the scoreboard gold ratio (enemy gold earned over its own), plus the enemy's Dragon buffs. Your pressure arrows and strength bars use the same estimate. Lower levels don't play at random. They make the **macro mistakes typical of their rank**, and higher levels make them less and less often. Challenger almost always plays the best tempo move, but even Master+ makes a small mistake now and then.

Each level is a data profile with a frequency per mistake (for example, Iron greeds 60% of the time and Challenger 1%). Mistakes are random rolls, but fights and waves stay deterministic.

| Mistake | What it looks like | Iron–Bronze | Silver–Gold | Plat–Emerald | Diamond | Master+ |
|---|---|---|---|---|---|---|
| **Greed / overextend** | Stays shoved with no vision, keeps pushing a tower with the enemy missing | very often | often | sometimes | rarely | very rarely |
| **Objective timing** | Shows up late to a spawn, starts it without priority, forgets respawn timers | very often | often | sometimes | rarely | very rarely |
| **Pointless plays** | Wanders for no reason: a random move within its own jungle, the river or its own lane | very often | often | sometimes | rarely | very rarely |
| **Chasing kills** | Picks fight over flee when outnumbered | very often | often | sometimes | rarely | very rarely |
| **Rotating without priority** | Leaves lane to help without the wave pushed | often | often | sometimes | rarely | very rarely |
| **Bad recall** | Recalls with the wave crashing into its own tower, right before a spawn, or sits on gold | often | often | sometimes | rarely | very rarely |
| **Poor vision** | Few wards, wards in useless spots, never clears wards | very often | often | sometimes | rarely | very rarely |
| **No conversion** | Wins a fight, then walks away without taking a tower or objective | often | sometimes | sometimes | rarely | very rarely |
| **Ignoring the enemy jungler** | Plays the same way whether or not the jungler was last seen nearby | very often | often | sometimes | rarely | very rarely |
| **Join fight** | Ignores a join 1 step away that would win the fight, or joins a fight it does not need or would not win | very often | often | sometimes | rarely | very rarely |

**Laning phase.** Until 14:00 (plates), AI laners stay in their lane and follow their wave: the normal role and priority rotations to objectives are off for laners. Only the jungler roams. The exceptions are recalls and the Emerald+ wave sacrifice, limited to the pit on the laner's half of the map (top to the Baron pit, bot to the Dragon). The mid laner, as far from both pits, never sacrifices its wave in this phase: it only rotates with priority (its wave pushed toward the enemy tower). Mistakes (rotating without priority, pointless plays) can still break the rule.

At any time, the AI skips an objective when the enemies it knows near the pit would win the fight against the group it could bring there, instead of walking in only to flee.

**Range and action.** The AI plays by the same step budget as you (see *Movement*). A target that needs an action (clearing a camp, taking a Scuttle, a live Dragon or Nashor, a laner's farm) counts as reached only where the AI still has a step left to act. One it can only arrive at is a walk toward it, scored lower (`aiTuning.walkPenalty`) because the round is lost: a jungler clears the camp in action range before walking to a farther buff, and a laner stops on the lane position where it still farms. Pushing a tower only needs presence. The AI invades only enemy camps whose timer it does not know to be down.

**Never under a tower without its wave** *(hard rule, never a mistake)*. An AI champion ends its move on a standing enemy tower only when it is that lane's front tower and the AI's wave is at it. This covers pushing, taking a tower after a won fight, Herald launches (the Herald waits for the wave) and pointless plays. When nothing else is allowed, the champion stays where it is.

**Contacts.** The AI answers a prompted contact with what it knows:

- on a contested river with something to take, it keeps taking the objective when its fight score × `fight.objectiveFocus` still wins, or is not lost while it has the numbers, or when the plain fight is an exact tie as it estimates it (a race costs no HP, where both sides fleeing an even fight would come back and flee again);
- otherwise it fights when it wins the fight (or, rolling *Chasing kills*, when outnumbered);
- outnumbered under its own tower with no ganker (lane pressure), it stays and farms, unless the bigger side would win by more than `aiTuning.allInMargin` and kill it;
- otherwise (a gank it would lose, for example) it flees.

**Joining a fight.** Before answering a contact, the AI decides which of its champions 1 step away join it, by the same predicted fight (with the HP the contact shows): none when the fight is already won; otherwise the fewest that turn a lost or tied fight into a won one; none when even all of them would not win it. It then answers the contact counting them. It does not know which of your champions will join. Rolling **Join fight** (`joinFight`, once per contact where it has a possible joiner) inverts the decision: it ignores a winning join, or sends all its possible joiners into a fight it did not need or would not win. Each champion joins one contact at most.

**Low HP.** A champion under `aiTuning.dangerHp` (25 HP) recalls whatever its wave or the objectives (priority `dangerRecall`, above objectives), the jungler too, unless it stands on or next to a pit objective that is up or that its side is taking. A champion rolling *Bad recall* stays in instead. Above that, a laner under `recallHp` (40 HP) still recalls only on a shoved or even wave.

Master, Grandmaster and Challenger keep a small mistake rate that goes down with each rank, and they also differ in how many rounds ahead they plan.

*(design call)* The AI is **rule-based**. It uses a library of macro heuristics (contest objectives with priority, recall on a shoved wave, track the jungler, convert leads) plus a board evaluation function, and each mistake is a switch on those rules. Master+ adds a shallow look-ahead of 1–2 rounds on its own candidate moves, without a full game-tree search.

## Data model

All values that are scored from 0–10 or -5 to +5 come as five numbers, one per game stage: *really early, early, mid, mid-late, late*.

**`champion`**

| Field | Example | Use |
|---|---|---|
| `id` | `LeeSin` | Riot Data Dragon key |
| `name` | `Lee Sin` | Display |
| `image` | `LeeSin.png` | Token on the map |
| `roles` | `[jungle]` | Playable roles, used by the random draft |
| `tags` | `[Fighter, Assassin]` | Class, used in teaching-mode explanations |
| `skirmish` | `[8, 8, 7, 5, 4]` | Skirmish strength per stage, 0–10 |
| `teamfight` | `[4, 5, 6, 5, 4]` | Teamfight strength per stage, 0–10 |
| `clearSpeed` | `7` | Unused, reserved: junglers clear one camp per round |
| `waveclear` | `3` | How well they push a wave, used as a tie-breaker, 0–10 |

**`matchup`** (top, jungle, mid)

| Field | Example | Use |
|---|---|---|
| `lane` | `top` | |
| `champion` / `opponent` | `Darius` / `Kayle` | Only one row per pair. Read the other way round, the sign flips. |
| `advantage` | `[+4, +3, +1, -2, -4]` | Advantage per stage, -5 to +5, from `champion`'s point of view |
| `source` | `riot-api` / `manual` | Where the value comes from |
| `patch` | `16.20` | Game version the value matches |

**`duo_matchup`** (bot lane)

ADC + support against ADC + support, with the same fields as `matchup`. Duo pairs are numerous and many have few games, so when a duo matchup is missing the game falls back to ADC vs ADC plus support vs support from `matchup`.

A missing matchup counts as 0 at every stage.

**Scope of the first version.** All champions are fetched from Data Dragon and CommunityDragon. Matchups are hand-entered for a restricted set of common champions, and the random draft draws from that set. The Riot API pipeline comes later.

**Sources.** Champion data comes from Riot Data Dragon and CommunityDragon. Later, matchups will be computed offline from the Riot API: gold and XP difference by lane at 6, 14 and 20 minutes, plus win rate by game length. Skirmish and teamfight ratings are written by hand from each champion's kit (damage pattern, crowd control, engage, scaling), then reviewed. Third-party stats sites are used only for manual sanity checks, never scraped. The game ships static JSON and never calls these sources at runtime.

**Legal.** This is a free fan-made training tool, not endorsed by Riot Games, and it follows Riot's "Legal Jibber Jabber" policy.

## Tech stack

- **TypeScript** everywhere, with **[Bun](https://bun.com/)** as runtime, dev server, bundler and test runner.
- **Rendering**: **Preact** and **@preact/signals** for the UI panels. The map is plain **SVG**, with no canvas or game engine, since the board is a fixed turn-based map with about 39 positions.
- The game is a static site, with no backend in the first version.

## Architecture

Three isolated Bun workspaces:

```
packages/
  data/     game values and their types
  engine/   game rules and calculations
  web/      rendering
```

- **`data`**: data only. Champions, matchups, the map graph (positions and links), phases and timers, objective rewards, AI profiles per rank. JSON files with TypeScript types, validated on load. The offline scripts that fetch from Data Dragon and the Riot API also live here.
- **`engine`**: pure TypeScript, with no DOM. The core is a deterministic function `resolveRound(state, blueOrders, redOrders, data)` that returns the next state plus a list of events (fight, flee, plate taken, death…). Teaching mode builds its explanations from these events. The AI lives here too, with a seeded random generator so games can be replayed. Tested with `bun test`.
- **`web`**: Preact + SVG. It displays the state and collects orders, and contains no game rules.

Dependencies only go one way: `web` → `engine` → `data`. This keeps the engine reusable, for example on a server for the online 1v1 mode later. A sandbox scenario is just a hand-built starting state.

**Contracts.** Each module exposes its shared types in `src/contracts/` (imported as `@lml/<pkg>/contracts`). Other modules import only these contracts, never internals. `packages/web/src/main.tsx` is the single composition root: it is the only place that picks the data source and engine implementations and wires them together. `scripts/check-deps.ts` enforces these rules and runs in CI.

**No database.** Game data is static JSON shipped with the site, and the game state lives in memory in the browser.

## Tech constraints

- Runs in the browser.
- Lightweight and data-driven: champions, matchups and objective timers live in data files, not in code.
