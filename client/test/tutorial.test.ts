import assert from "node:assert/strict";
import test from "node:test";
import { allTutorialDrills, isExpectedAction, learnerId, setupDrill, tickDrill, tutorialChapters } from "../src/game/tutorial.ts";
import { getTurnView, playTurn, type TurnAction } from "../src/game/turn.ts";

test("chaque exercice guidé accepte ses gestes et ses transitions dans le moteur", () => {
  for (const drill of allTutorialDrills.filter(({ memory }) => !memory)) {
    let state = setupDrill(drill);
    let now = 0;
    let reactions = 0;
    for (const step of drill.steps) {
      if (step.kind === "wait") {
        now += step.delay;
        const before = state;
        state = tickDrill(state, step, now);
        if (step.operation) assert.notEqual(state, before, `${drill.title} : ${step.text}`);
        continue;
      }
      const learner = state.players.find(({ id }) => id === learnerId)!;
      const position = step.target?.position ?? 0;
      let action: TurnAction;
      switch (step.action) {
        case "draw": action = { kind: "draw", source: "deck" }; break;
        case "dutch-intent": action = { kind: step.action, enabled: true }; break;
        case "replace": action = { kind: step.action, position, handVersion: learner.handVersion }; break;
        case "reaction":
          action = { kind: step.action, position, reference: state.reaction.reference, handVersion: learner.handVersion };
          reactions++;
          break;
        case "power-card": {
          const target = step.target!;
          const handVersion = state.players.find(({ id }) => id === target.playerId)!.handVersion;
          action = { kind: step.action, target, handVersion };
          break;
        }
        case "power-player": action = { kind: step.action, playerId: step.target!.playerId }; break;
        case "power-pass":
        case "power-hide":
        case "power-swap":
        case "discard": action = { kind: step.action }; break;
        default: throw new Error(`Action inattendue : ${step.action}`);
      }
      assert.ok(isExpectedAction(step, action, step.gesture));
      if (step.gesture) assert.equal(isExpectedAction(step, action, undefined), false);
      const next = playTurn(state, learnerId, state.turn?.number, action, ++now);
      assert.notEqual(next, state, `${drill.title} : ${step.text}`);
      state = next;
    }
    if (drill.title === "Reconnaître une erreur") assert.equal(state.reaction.notice?.outcome, "penalty");
    else if (reactions) assert.equal(state.players[0].cards.length, 4 - reactions);
    if (drill.title === "Tester Dutch en fin de manche") {
      assert.equal(state.phase, "results");
      assert.equal(state.result?.dutchAnnouncerId, learnerId);
      assert.ok(state.result?.winnerIds.includes(learnerId));
    }
  }
});

test("les indices de tutoriel s’appuient sur le geste demandé et gardent le Valet privé", () => {
  const drill = tutorialChapters.find(({ id }) => id === "poser")!.drills[0];
  assert.equal(isExpectedAction(drill.steps[1], { kind: "replace", position: 0, handVersion: 0 }, "tap"), false);
  assert.equal(isExpectedAction(drill.steps[1], { kind: "replace", position: 1, handVersion: 0 }, "drag"), false);
  const state = setupDrill(tutorialChapters.find(({ id }) => id === "echanges")!.drills[1]);
  const drawn = playTurn(state, learnerId, 1, { kind: "draw", source: "deck" }, 1);
  const discarded = playTurn(drawn, learnerId, 1, { kind: "discard" }, 2);
  const selected = playTurn(discarded, learnerId, 1, { kind: "power-card", target: { playerId: learnerId, position: 0 }, handVersion: 0 }, 3);
  const other = { playerId: "nora", position: 0 };
  const both = playTurn(selected, learnerId, 1, { kind: "power-card", target: other, handVersion: 0 }, 4);
  assert.equal(getTurnView(both, learnerId, 4)?.power?.selection?.revealed.length, 2);
  assert.equal(getTurnView(both, "nora", 4)?.power?.selection, null);
});
