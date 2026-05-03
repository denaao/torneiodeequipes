export const QUALIFYING_SCORES = {
  1: 30, 2: 25, 3: 22, 4: 18, 5: 15, 6: 12, 7: 10, 8: 8
};

export const FINAL_SCORES = {
  1: 80, 2: 70, 3: 60, 4: 40, 5: 34, 6: 30, 7: 26, 8: 22
};

export function getQualifyingPoints(position) {
  return QUALIFYING_SCORES[position] || 0;
}

export function getFinalPoints(position) {
  return FINAL_SCORES[position] || 0;
}

export function eliminationToPosition(eliminationOrder, totalPlayers) {
  return totalPlayers + 1 - eliminationOrder;
}
