(function (root, factory) {
  "use strict";
  const board = typeof module === "object" && module.exports
    ? require("./board-data.js")
    : root.CoupleFlightBoardData;
  const api = factory(board);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CoupleFlightEngine = api;
})(typeof window !== "undefined" ? window : globalThis, function (board) {
  "use strict";

  const VERSION = 3;
  const PATH_LENGTH = 44;
  const FINISH = 45;
  const MAX_EFFECT_CHAIN = 8;
  const PHASES = new Set(["await_roll", "await_card", "finished"]);
  const SPECIAL_TYPES = new Set(["reward", "penalty"]);
  const NORMAL_TYPES = new Set(["truth", "dare"]);

  if (!board || !Array.isArray(board.tiles) || board.tiles.length !== PATH_LENGTH ||
      !board.startPositions || board.startPositions.shared !== 1 ||
      board.startPositions.pink !== 1 || board.startPositions.blue !== 1) {
    throw new Error("board-data.js must load before engine.js and contain the 44-square board");
  }

  function isIntegerBetween(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  function normalizeNames(names) {
    const supplied = names === undefined ? ["玩家一", "玩家二"] : names;
    if (!Array.isArray(supplied) || supplied.length !== 2) {
      throw new TypeError("names must contain exactly two player names");
    }
    return supplied.map((name) => {
      if (typeof name !== "string" || !name.trim()) {
        throw new TypeError("each player name must be a nonempty string");
      }
      return name.trim();
    });
  }

  // Both pieces have independent progress but follow the same 44-square route.
  function getSquareForProgress(player, progress) {
    if (!isIntegerBetween(player, 0, 1)) throw new RangeError("player must be 0 or 1");
    if (!isIntegerBetween(progress, 0, FINISH)) throw new RangeError("progress must be from 0 to 45");
    if (progress === 0 || progress === FINISH) return null;
    return progress;
  }

  function getTileForProgress(player, progress) {
    const square = getSquareForProgress(player, progress);
    return square === null ? null : board.tiles[square - 1];
  }

  function createGame(names, firstPlayer = 0) {
    const [first, second] = normalizeNames(names);
    if (!isIntegerBetween(firstPlayer, 0, 1)) throw new RangeError("firstPlayer must be 0 or 1");
    return {
      version: VERSION,
      players: [{ name: first, progress: 0 }, { name: second, progress: 0 }],
      current: firstPlayer,
      phase: "await_roll",
      pendingCard: null,
      firstWinner: null,
      finaleChoice: null,
      lastRoll: null,
      turnNumber: 1,
      chainDepth: 0,
    };
  }

  function promptTypeForCard(cardId) {
    const tile = board.tiles.find((item) => item.promptId === cardId);
    return tile ? tile.type : null;
  }

  function validateState(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    if (state.version !== VERSION) return false;
    if (!Array.isArray(state.players) || state.players.length !== 2) return false;
    for (const player of state.players) {
      if (!player || typeof player !== "object" || Array.isArray(player)) return false;
      if (typeof player.name !== "string" || !player.name.trim()) return false;
      if (!isIntegerBetween(player.progress, 0, FINISH)) return false;
    }
    if (!isIntegerBetween(state.current, 0, 1) || !PHASES.has(state.phase)) return false;
    if (!isIntegerBetween(state.turnNumber, 1, Number.MAX_SAFE_INTEGER)) return false;
    if (!isIntegerBetween(state.chainDepth, 0, MAX_EFFECT_CHAIN)) return false;
    if (state.lastRoll !== null && !isIntegerBetween(state.lastRoll, 1, 6)) return false;
    if (state.firstWinner !== null && !isIntegerBetween(state.firstWinner, 0, 1)) return false;
    if (state.finaleChoice !== null && !isIntegerBetween(state.finaleChoice, 1, 3)) return false;

    if (state.phase === "finished") {
      if (state.firstWinner !== state.current || state.players[state.current].progress !== FINISH) return false;
      if (state.players[1 - state.current].progress === FINISH || state.pendingCard !== null) return false;
      return true;
    }
    if (state.firstWinner !== null || state.finaleChoice !== null) return false;
    if (state.players.some((player) => player.progress === FINISH)) return false;
    if (state.phase === "await_roll") return state.pendingCard === null && state.chainDepth === 0;

    const card = state.pendingCard;
    if (!card || typeof card !== "object" || Array.isArray(card)) return false;
    const progress = state.players[state.current].progress;
    if (!isIntegerBetween(progress, 1, PATH_LENGTH)) return false;
    const square = getSquareForProgress(state.current, progress);
    const tile = board.tiles[square - 1];
    if (card.square !== square || card.type !== tile.type) return false;
    if (NORMAL_TYPES.has(tile.type)) {
      return isIntegerBetween(card.cardId, 1, 36) && promptTypeForCard(card.cardId) === tile.type;
    }
    return SPECIAL_TYPES.has(tile.type) && card.cardId === null && state.chainDepth < MAX_EFFECT_CHAIN;
  }

  function copyState(state) {
    return {
      ...state,
      players: state.players.map((player) => ({ ...player })),
      pendingCard: state.pendingCard ? { ...state.pendingCard } : null,
    };
  }

  function changeTurn(state, events) {
    state.current = 1 - state.current;
    state.phase = "await_roll";
    state.pendingCard = null;
    state.chainDepth = 0;
    state.turnNumber += 1;
    events.push({ type: "turn_changed", player: state.current, turnNumber: state.turnNumber });
  }

  function finish(state, events) {
    state.phase = "finished";
    state.pendingCard = null;
    state.firstWinner = state.current;
    events.push({ type: "first_winner", player: state.current });
  }

  function presentLanding(state, events) {
    const player = state.current;
    const progress = state.players[player].progress;
    if (progress === FINISH) {
      finish(state, events);
      return;
    }
    const square = getSquareForProgress(player, progress);
    const tile = board.tiles[square - 1];
    // A custom board could bounce between two special squares forever.
    if (SPECIAL_TYPES.has(tile.type) && state.chainDepth >= MAX_EFFECT_CHAIN) {
      events.push({ type: "chain_stopped", player, square, depth: state.chainDepth });
      changeTurn(state, events);
      return;
    }
    state.phase = "await_card";
    state.pendingCard = { square, type: tile.type, cardId: tile.promptId || null };
    events.push({ type: "card", player, square, tileType: tile.type, cardId: tile.promptId || null });
  }

  function traceMove(from, distance) {
    const route = [];
    let progress = from;
    let direction = Math.sign(distance);
    for (let step = 0; step < Math.abs(distance); step += 1) {
      let next = progress + direction;
      if (next > FINISH || next < 0) {
        direction *= -1;
        next = progress + direction;
      }
      route.push(next);
      progress = next;
    }
    return route;
  }

  function move(state, events, distance, source) {
    const player = state.current;
    const from = state.players[player].progress;
    const route = traceMove(from, distance);
    const to = route[route.length - 1];
    state.players[player].progress = to;
    events.push({
      type: "move", player, source,
      from, to, route,
      fromProgress: from, toProgress: to, steps: route,
      distance,
    });
    presentLanding(state, events);
  }

  function reduce(state, action) {
    if (!validateState(state)) throw new TypeError("invalid game state");
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      throw new TypeError("action must have a type");
    }

    if (action.type === "RESTART") {
      const names = action.names === undefined ? state.players.map((player) => player.name) : action.names;
      const restarted = createGame(names, action.firstPlayer === undefined ? 0 : action.firstPlayer);
      return {
        state: restarted,
        events: [{ type: "restart", names: restarted.players.map((player) => player.name), firstPlayer: restarted.current }],
      };
    }

    const next = copyState(state);
    const events = [];
    const player = next.current;

    if (action.type === "ROLL") {
      if (next.phase !== "await_roll") throw new Error("cannot roll in the current phase");
      if (!isIntegerBetween(action.die, 1, 6)) throw new RangeError("die must be an integer from 1 to 6");
      const die = action.die;
      next.lastRoll = die;
      next.chainDepth = 0;
      events.push({ type: "roll", player, die });
      if (next.players[player].progress === 0) {
        if (die % 2 === 0) {
          events.push({ type: "launch", player, die, square: getSquareForProgress(player, 1) });
          move(next, events, 1, "launch");
        } else {
          events.push({ type: "launch_failed", player, die });
          changeTurn(next, events);
        }
      } else {
        move(next, events, die, "die");
      }
    } else if (action.type === "SWAP_CARD") {
      if (next.phase !== "await_card" || !NORMAL_TYPES.has(next.pendingCard.type)) {
        throw new Error("there is no truth-or-dare card to swap");
      }
      if (!isIntegerBetween(action.cardId, 1, 36)) throw new RangeError("cardId must be an integer from 1 to 36");
      if (action.cardId === next.pendingCard.cardId) throw new RangeError("choose a different card");
      if (promptTypeForCard(action.cardId) !== next.pendingCard.type) {
        throw new RangeError("the new card must keep the same truth-or-dare type");
      }
      const fromCardId = next.pendingCard.cardId;
      next.pendingCard.cardId = action.cardId;
      events.push({ type: "card_swapped", player, square: next.pendingCard.square, fromCardId, toCardId: action.cardId });
    } else if (action.type === "RESOLVE_CARD") {
      if (next.phase !== "await_card") throw new Error("there is no card to resolve");
      const card = next.pendingCard;
      const skipped = action.skipped === true;
      if (NORMAL_TYPES.has(card.type)) {
        events.push({ type: "card_resolved", player, square: card.square, cardId: card.cardId, skipped });
        changeTurn(next, events);
      } else {
        const options = card.type === "reward" ? board.rewards : board.penalties;
        if (!skipped && (!options || !options.some((option) => option.id === action.optionId))) {
          throw new RangeError("choose a valid optionId from 1 to 3, or skip by mutual agreement");
        }
        if (skipped) events.push({ type: "choice_skipped", player, square: card.square, tileType: card.type });
        else events.push({ type: "choice_confirmed", player, square: card.square, tileType: card.type, optionId: action.optionId });
        next.pendingCard = null;
        next.chainDepth += 1;
        move(next, events, card.type === "reward" ? 2 : -2, card.type);
      }
    } else if (action.type === "CHOOSE_FINALE") {
      if (next.phase !== "finished") throw new Error("the game is not finished");
      if (next.finaleChoice !== null) throw new Error("the final promise has already been chosen");
      if (!board.finaleOptions || !board.finaleOptions.some((option) => option.id === action.optionId)) {
        throw new RangeError("choose a valid final optionId from 1 to 3");
      }
      next.finaleChoice = action.optionId;
      events.push({ type: "finale_chosen", player: next.firstWinner, optionId: action.optionId });
    } else {
      throw new RangeError("unknown action type");
    }

    return { state: next, events };
  }

  // Only untouched older games can be converted without remapping a piece or card.
  function migrateLegacyState(legacy) {
    if (!legacy || ![1, 2].includes(legacy.version) || legacy.phase !== "await_roll" ||
        legacy.pendingCard !== null || !Array.isArray(legacy.players) || legacy.players.length !== 2 ||
        !isIntegerBetween(legacy.current, 0, 1) || legacy.turnNumber !== 1) return null;
    const untouched = legacy.version === 1
      ? legacy.players.every((player) => player && player.position === 0)
      : legacy.players.every((player) => player && player.progress === 0) &&
        legacy.firstWinner === null && legacy.finaleChoice === null &&
        legacy.lastRoll === null && legacy.chainDepth === 0;
    if (!untouched) return null;
    try {
      return createGame(legacy.players.map((player) => player.name), legacy.current);
    } catch (_) {
      return null;
    }
  }

  return {
    VERSION, PATH_LENGTH, FINISH, MAX_EFFECT_CHAIN,
    createGame, reduce, validateState, migrateLegacyState,
    getSquareForProgress, getTileForProgress,
  };
});
