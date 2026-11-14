type EventTeams = {
  homeTeam: string;
  awayTeam: string;
};

export function outcomeDisplayName(event: EventTeams, selection: string) {
  const normalized = selection.trim().toLowerCase();

  if (["home", "1", "team 1"].includes(normalized)) return event.homeTeam;
  if (["away", "2", "team 2"].includes(normalized)) return event.awayTeam;
  if (["draw", "x", "tie"].includes(normalized)) return "Draw";

  return selection;
}
