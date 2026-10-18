const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../js/engine.js");
const board = require("../js/board-data.js");

function act(state, action) {
  const input = JSON.stringify(state);
  const result = engine.reduce(state, action);
  assert.equal(engine.validateState(result.state), true, "reducer must return a valid state");
  assert.equal(JSON.stringify(state), input, "reducer must not mutate its input");
  return result;
}

function withProgress(pink, blue, current = 0) {
  const state = engine.createGame(["阿晴", "阿屿"], current);
  state.players[0].progress = pink;
  state.players[1].progress = blue;
  assert.equal(engine.validateState(state), true);
  return state;
}

function progressForSquare(player, square) {
  for (let progress = 1; progress <= 44; progress += 1) {
    if (engine.getSquareForProgress(player, progress) === square) return progress;
  }
  throw new Error("square not found");
}

test("board and prompt mapping have 44 squares and exactly 36 interaction cards", () => {
  assert.equal(board.validateBoardData().valid, true);
  assert.deepEqual(board.validateBoardData().counts, {
    truth: 18, dare: 18, reward: 4, penalty: 4,
  });
  assert.deepEqual(board.tiles.filter((tile) => tile.type === "reward").map((tile) => tile.id), [5, 15, 25, 35]);
  assert.deepEqual(board.tiles.filter((tile) => tile.type === "penalty").map((tile) => tile.id), [10, 20, 30, 40]);
  assert.equal(board.tiles[22].promptId, 19);
  assert.equal(engine.PATH_LENGTH, 44);
  assert.equal(engine.FINISH, 45);
});

test("new game supports either randomly chosen first player and JSON save/load", () => {
  const game = engine.createGame([" 阿晴 ", " 阿屿 "], 1);
  assert.equal(game.version, 3);
  assert.deepEqual(game.players.map((player) => player.name), ["阿晴", "阿屿"]);
  assert.deepEqual(game.players.map((player) => player.progress), [0, 0]);
  assert.equal(game.current, 1);
  assert.equal(game.phase, "await_roll");
  assert.equal(game.turnNumber, 1);
  assert.equal(engine.validateState(JSON.parse(JSON.stringify(game))), true);
  assert.throws(() => engine.createGame(["甲", "乙"], 2), /firstPlayer/);
});

test("both players enter square 1 and independently traverse the same 44-square route", () => {
  assert.deepEqual(board.startPositions, { shared: 1, pink: 1, blue: 1 });
  for (const player of [0, 1]) {
    assert.equal(engine.getSquareForProgress(player, 1), 1);
    assert.equal(engine.getSquareForProgress(player, 22), 22);
    assert.equal(engine.getSquareForProgress(player, 23), 23);
    assert.equal(engine.getSquareForProgress(player, 44), 44);
  }
  assert.equal(engine.getSquareForProgress(0, 0), null);
  assert.equal(engine.getSquareForProgress(1, 45), null);
  assert.equal(engine.getTileForProgress(1, 1).id, 1);
});

test("only 2, 4, and 6 launch; failed odd roll changes turn with no guarantee", () => {
  let state = engine.createGame();
  const failed = act(state, { type: "ROLL", die: 1 });
  assert.equal(failed.state.players[0].progress, 0);
  assert.equal(failed.state.current, 1);
  assert.deepEqual(failed.events.map((event) => event.type), ["roll", "launch_failed", "turn_changed"]);
  state = failed.state;
  const launched = act(state, { type: "ROLL", die: 2 });
  assert.equal(launched.state.players[1].progress, 1);
  assert.equal(launched.state.pendingCard.square, 1);
  assert.deepEqual(launched.events.find((event) => event.type === "move").route, [1]);
  assert.equal(launched.events.find((event) => event.type === "move").source, "launch");
  assert.equal(act(launched.state, { type: "RESOLVE_CARD" }).state.current, 0);

  for (const die of [4, 6]) {
    const result = act(engine.createGame(), { type: "ROLL", die });
    assert.equal(result.state.players[0].progress, 1);
    assert.equal(result.state.phase, "await_card");
    const resolved = act(result.state, { type: "RESOLVE_CARD" });
    assert.equal(resolved.state.current, 1, "six does not grant a bonus roll in the current rules");
  }
});

test("rolling moves blue one square at a time along the shared route", () => {
  const result = act(withProgress(0, 21, 1), { type: "ROLL", die: 3 });
  const movement = result.events.find((event) => event.type === "move");
  assert.deepEqual(movement.steps, [22, 23, 24]);
  assert.deepEqual(movement.route, [22, 23, 24]);
  assert.equal(movement.from, 21);
  assert.equal(movement.to, 24);
  assert.equal(movement.fromProgress, 21);
  assert.equal(movement.toProgress, 24);
  assert.deepEqual(movement.steps.map((progress) => engine.getSquareForProgress(1, progress)), [22, 23, 24]);
  assert.equal(result.state.pendingCard.square, 24);
});

test("truth and dare cards map to their own prompt types and can be swapped within type", () => {
  const pink = act(withProgress(0, 0), { type: "ROLL", die: 2 });
  assert.deepEqual(pink.state.pendingCard, { square: 1, type: "truth", cardId: 1 });
  const swapped = act(pink.state, { type: "SWAP_CARD", cardId: 3 });
  assert.equal(swapped.state.pendingCard.cardId, 3);
  assert.equal(pink.state.pendingCard.cardId, 1);
  assert.throws(() => act(swapped.state, { type: "SWAP_CARD", cardId: 2 }), /same truth-or-dare type/);
  assert.throws(() => act(swapped.state, { type: "SWAP_CARD", cardId: 3 }), /different card/);
  assert.throws(() => act(swapped.state, { type: "SWAP_CARD", cardId: 37 }), /cardId/);
  const dare = act(withProgress(1, 0), { type: "ROLL", die: 1 });
  assert.equal(dare.state.pendingCard.type, "dare");
  assert.equal(dare.state.pendingCard.cardId, 2);
});

test("reward choice is confirmed before moving +2, then destination card must be completed", () => {
  const reward = act(withProgress(1, 0), { type: "ROLL", die: 4 });
  assert.equal(reward.state.players[0].progress, 5);
  assert.deepEqual(reward.state.pendingCard, { square: 5, type: "reward", cardId: null });
  assert.throws(() => act(reward.state, { type: "RESOLVE_CARD" }), /optionId/);
  const resolved = act(reward.state, { type: "RESOLVE_CARD", optionId: 1 });
  assert.equal(resolved.events[0].type, "choice_confirmed");
  assert.equal(resolved.events[0].optionId, 1);
  assert.deepEqual(resolved.events.find((event) => event.type === "move").route, [6, 7]);
  assert.equal(resolved.events.find((event) => event.type === "move").source, "reward");
  assert.equal(resolved.state.players[0].progress, 7);
  assert.deepEqual(resolved.state.pendingCard, { square: 7, type: "truth", cardId: 5 });
  assert.equal(resolved.state.current, 0);
  assert.equal(act(resolved.state, { type: "RESOLVE_CARD" }).state.current, 1);
});

test("penalty choice moves -2 before the new dare card, and mutually agreed skip still applies movement", () => {
  const penalty = act(withProgress(9, 0), { type: "ROLL", die: 1 });
  assert.deepEqual(penalty.state.pendingCard, { square: 10, type: "penalty", cardId: null });
  const resolved = act(penalty.state, { type: "RESOLVE_CARD", optionId: 2 });
  assert.deepEqual(resolved.events.find((event) => event.type === "move").route, [9, 8]);
  assert.equal(resolved.events.find((event) => event.type === "move").source, "penalty");
  assert.equal(resolved.state.pendingCard.type, "dare");
  assert.equal(resolved.state.pendingCard.square, 8);
  assert.equal(resolved.state.current, 0);
  const skipped = act(penalty.state, { type: "RESOLVE_CARD", skipped: true });
  assert.equal(skipped.events[0].type, "choice_skipped");
  assert.equal(skipped.state.players[0].progress, 8);
  assert.equal(act(skipped.state, { type: "RESOLVE_CARD", skipped: true }).state.current, 1);
});

test("all eight special squares resolve into a normal task for either player", () => {
  for (const player of [0, 1]) {
    for (const square of [5, 10, 15, 20, 25, 30, 35, 40]) {
      const progress = progressForSquare(player, square);
      const state = withProgress(player === 0 ? progress : 0, player === 1 ? progress : 0, player);
      state.phase = "await_card";
      state.pendingCard = { square, type: board.tiles[square - 1].type, cardId: null };
      assert.equal(engine.validateState(state), true);
      const result = act(state, { type: "RESOLVE_CARD", optionId: 1 });
      assert.equal(result.state.phase, "await_card");
      assert.ok(["truth", "dare"].includes(result.state.pendingCard.type));
      assert.equal(result.state.chainDepth, 1);
    }
  }
});

test("two pieces may share one absolute square without capture", () => {
  // Pink has already launched; blue's even roll enters the same first square.
  const result = act(withProgress(1, 0, 1), { type: "ROLL", die: 2 });
  assert.equal(engine.getSquareForProgress(0, result.state.players[0].progress), 1);
  assert.equal(engine.getSquareForProgress(1, result.state.players[1].progress), 1);
  assert.deepEqual(result.state.players.map((player) => player.progress), [1, 1]);
  assert.equal(result.state.pendingCard.square, 1);
  assert.equal(result.events.some((event) => event.type === "capture"), false);
});

test("exact finish wins immediately; an overshoot visits the heart and bounces back", () => {
  const exact = act(withProgress(44, 10), { type: "ROLL", die: 1 });
  assert.deepEqual(exact.events.find((event) => event.type === "move").route, [45]);
  assert.equal(exact.state.phase, "finished");
  assert.equal(exact.state.firstWinner, 0);
  assert.equal(exact.state.pendingCard, null);
  assert.ok(exact.events.some((event) => event.type === "first_winner"));
  assert.throws(() => act(exact.state, { type: "ROLL", die: 1 }), /cannot roll/);

  const bounce = act(withProgress(44, 10), { type: "ROLL", die: 6 });
  assert.deepEqual(bounce.events.find((event) => event.type === "move").route, [45, 44, 43, 42, 41, 40]);
  assert.equal(bounce.state.players[0].progress, 40);
  assert.equal(bounce.state.phase, "await_card");
  assert.equal(bounce.state.pendingCard.type, "penalty");
  assert.equal(bounce.events.some((event) => event.type === "first_winner"), false);

  const blueExact = act(withProgress(12, 44, 1), { type: "ROLL", die: 1 });
  assert.deepEqual(blueExact.events.find((event) => event.type === "move").route, [45]);
  assert.equal(blueExact.state.firstWinner, 1);
  assert.equal(blueExact.state.players[0].progress, 12);
});

test("the winner can choose one final promise and restart with new names and first player", () => {
  const won = act(withProgress(44, 0), { type: "ROLL", die: 1 }).state;
  const choice = act(won, { type: "CHOOSE_FINALE", optionId: 2 });
  assert.equal(choice.state.finaleChoice, 2);
  assert.deepEqual(choice.events, [{ type: "finale_chosen", player: 0, optionId: 2 }]);
  assert.throws(() => act(choice.state, { type: "CHOOSE_FINALE", optionId: 1 }), /already/);
  const restarted = act(choice.state, { type: "RESTART", names: ["小粉", "小蓝"], firstPlayer: 1 });
  assert.deepEqual(restarted.state.players.map((player) => player.name), ["小粉", "小蓝"]);
  assert.deepEqual(restarted.state.players.map((player) => player.progress), [0, 0]);
  assert.equal(restarted.state.current, 1);
  assert.equal(restarted.state.finaleChoice, null);
});

test("version checks reject malformed saves and migrate only untouched V1 or V2 sessions", () => {
  const game = engine.createGame();
  assert.equal(engine.validateState({ ...game, version: 1 }), false);
  assert.equal(engine.validateState({ ...game, players: [{ ...game.players[0], progress: 46 }, game.players[1]] }), false);
  assert.equal(engine.validateState({ ...game, pendingCard: { square: 1 } }), false);
  assert.equal(engine.validateState({ ...game, chainDepth: 1 }), false);
  assert.throws(() => engine.reduce({ ...game, version: 1 }, { type: "ROLL", die: 2 }), /invalid game state/);
  const legacy = {
    version: 1, phase: "await_roll", pendingCard: null, current: 1, turnNumber: 1,
    players: [{ name: "阿晴", position: 0 }, { name: "阿屿", position: 0 }],
  };
  assert.equal(engine.migrateLegacyState(legacy).current, 1);
  assert.equal(engine.migrateLegacyState({ ...legacy, players: [{ name: "阿晴", position: 3 }, legacy.players[1]] }), null);
  const prior = { ...engine.createGame(["阿晴", "阿屿"], 1), version: 2 };
  assert.equal(engine.validateState(prior), false);
  assert.equal(engine.migrateLegacyState(prior).version, 3);
  assert.equal(engine.migrateLegacyState(prior).current, 1);
  assert.equal(engine.migrateLegacyState({ ...prior, players: [{ ...prior.players[0], progress: 1 }, prior.players[1]] }), null);
});

test("invalid actions and option IDs are rejected", () => {
  const game = engine.createGame();
  assert.throws(() => act(game, { type: "ROLL", die: 0 }), /die/);
  assert.throws(() => act(game, { type: "RESOLVE_CARD" }), /no card/);
  assert.throws(() => act(game, { type: "SWAP_CARD", cardId: 3 }), /no truth-or-dare card/);
  assert.throws(() => act(game, { type: "CHOOSE_FINALE", optionId: 1 }), /not finished/);
  assert.throws(() => act(game, { type: "UNKNOWN" }), /unknown action/);
  const reward = act(withProgress(1, 0), { type: "ROLL", die: 4 }).state;
  assert.throws(() => act(reward, { type: "RESOLVE_CARD", optionId: 0 }), /optionId/);
  assert.throws(() => act(reward, { type: "SWAP_CARD", cardId: 3 }), /no truth-or-dare card/);
});

test("every die route has one adjacent step per pip and only ends in a win at progress 45", () => {
  for (const player of [0, 1]) {
    for (let progress = 1; progress <= 44; progress += 1) {
      for (let die = 1; die <= 6; die += 1) {
        const state = withProgress(player === 0 ? progress : 0, player === 1 ? progress : 0, player);
        const result = act(state, { type: "ROLL", die });
        const movement = result.events.find((event) => event.type === "move");
        assert.equal(movement.route.length, die);
        let previous = progress;
        for (const step of movement.route) {
          assert.equal(Math.abs(step - previous), 1);
          previous = step;
        }
        assert.equal(result.state.phase === "finished", movement.to === 45);
      }
    }
  }
});
