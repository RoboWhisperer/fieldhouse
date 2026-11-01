# Stats and play-by-play scoring

Fieldhouse keeps an append-only event log for every game: scores, fouls, timeouts, period changes, clock edits, marks, and undos. The log is the source of truth for the score bug, the clock, replay, sponsor breaks, and highlights.

## Entering stats during a game

On the **Live** console, use the scoring buttons (keyboard shortcuts are configurable in Settings > Shortcuts). Every press appends an event to the game log and can be undone.

## Importing a play-by-play sheet

A scorekeeper can export a play-by-play sheet as CSV and import it after (or during) a game:

```
POST /api/games/:id/stats
Content-Type: application/json

{ "text": "type,team,points,player,note\nscore,home,2,12,\nscore,away,3,5,\nfoul,home,,,\ntimeout,away,,,\nmark,,,,\"Great play\"" }
```

CSV columns (a header row is optional):

| Column | Meaning | Example |
|--------|---------|---------|
| `type` | `score`, `foul`, `timeout`, `mark`, `period.set`, `clock.start`, `clock.stop`, `undo` | `score` |
| `team` | `home` or `away` | `home` |
| `points` | points for a score | `2` or `3` |
| `player` | player number | `12` |
| `note` | free text for a mark | `Great play` |

Rows are appended to the game's event log in order and show up immediately in the log, the score bug, and highlights. Fields containing commas should be wrapped in double quotes.

## What the log drives

- **Score bug / clock** — shown on the overlay and the phone remote
- **Replay** — each scored/marked event gets a Replay button in the Events panel
- **Highlights** — scores and marks become clips (see Replay and highlights)
- **Sponsor breaks** — rules fire on triggers like timeouts and period ends
- **Proof of play** — every sponsor airing is logged with timestamp and outcome

The full event log can be exported as JSON or CSV from the game's Wrap-up screen.
