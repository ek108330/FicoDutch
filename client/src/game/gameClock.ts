import type { GameState } from "./gameTypes";

export function resumeGameClock(state: GameState, pausedFor: number): GameState {
  if (pausedFor <= 0) return state;
  return {
    ...state,
    phaseDeadline: state.phaseDeadline === null ? null : state.phaseDeadline + pausedFor,
    turn: state.turn && { ...state.turn, deadline: state.turn.deadline + pausedFor },
  };
}
