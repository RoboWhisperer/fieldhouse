# Sport profiles

A sport profile tells Fieldhouse how your sport is played: how many periods, how long they are, whether the clock counts down or up, which scoring buttons you need, and what you want to count for each team (fouls, timeouts, cards, penalties).

Fieldhouse comes with five: **Basketball**, **Soccer**, **American football**, **Volleyball** and **Ice hockey**. You can change any of them, copy one and adjust it, or build your own from scratch for a sport that is not on the list.

> **Beta.** The rules engine for every profile is tested. The screens for choosing and editing profiles are still being built: for now the Settings > Sport profile screen edits the basketball numbers only, and the console and phone remote show basketball buttons. The profile choice and editor screens follow.

## What a profile contains

| Part | What it controls | Example |
|------|------------------|---------|
| Periods | How many, what they are called, how long, and whether overtime exists | 4 quarters of 8 minutes, then 4-minute "OT" periods |
| Clock | Counts down, counts up, or there is no clock | Basketball down, soccer up, volleyball none |
| Scoring | The score buttons and their points | Football: Touchdown 6, Extra point 1, Two-point try 2, Field goal 3, Safety 2 |
| Counters | Numbers kept for each team | Team fouls (with a "Bonus" at 5), timeouts (3 per team), yellow cards |
| Set rules | For sports played in sets: points to win a set, lead needed, sets to win the match | Volleyball: 25, win by 2, the 5th set to 15, best of 5 |

## Good to know

- **Each game keeps the rules it started with.** If you change a profile in the middle of the season, games you already started do not change, and neither does their history. New games use the new rules.
- **Choose the sport for a game** when you set it up. Games you do not choose for use the default sport in Settings.
- **Counters** can reset each period (team fouls), or only at certain periods (football timeouts come back in the second half), or never (soccer cards).
- **Soccer's clock counts up** and does not stop at 45:00, so stoppage time just keeps going. The second half starts at 45:00.
- **Volleyball has no clock.** Tap each rally point. When a team wins a set (25 with a 2-point lead, 15 in the 5th set) Fieldhouse records the set and starts the next one at 0-0. Undo the last point if you tapped one too many.
- **Undo** works for scores and counters in every sport.
- **Share a profile.** A profile can be exported as a small file and imported on another computer. Imported profiles never replace the ones you have.
- **Built-in profiles cannot be deleted**, but Reset puts the original rules back after you have changed one.

## Limits

Up to 12 periods, 8 ways to score (1 to 99 points each), 12 counters per sport, and names up to 24 characters. If something does not fit, Fieldhouse says what to change.

## For programmers

The data format, the HTTP routes and three worked examples (including a made-up sport) are in [Sport profiles (developer guide)](dev/profiles.md).
