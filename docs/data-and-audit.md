# Game deletion, audit and data export

Fieldhouse keeps its records on the computer that runs the broadcast. These tools help you clean up old games and show what happened without sending data anywhere.

## Delete a game

Open **Home** or **All games**. Upcoming and final games have a **Delete** button. Live games must be finished first.

Deleting a game removes:

- the game and its event log
- sponsor airings for that game
- engine health history for that game
- the active-game pointer, if that game was active

Recordings are **kept** by default, so a deleted game's video remains in Storage. To remove the recordings too, send:

```http
DELETE /api/games/<game-id>
Content-Type: application/json

{"deleteRecordings": true}
```

The deletion is written to the audit log. Recordings that are still being written block deletion.

## Audit log

**Settings > Audit and data** shows the most recent 100 changes. The log is append-only, stored in the same local database, and capped at 10,000 entries. A full data reset keeps the audit history.

You can also read it from:

```http
GET /api/audit?limit=100
GET /api/audit?action=game.deleted
GET /api/audit?target=<game-id>
```

Each entry has a timestamp, action, optional target and actor (`console` for the operator console, `remote` when a phone pairs itself). Remote pairing, denied pairing requests, API keys, device role changes and revocation, remote lock/unlock and pairing-code rotation are recorded too. Secret-looking detail keys and text are removed before an entry is saved.

## Health

`GET /api/health` returns a small status object with no secrets, suitable for a local uptime check:

```json
{
  "status": "ok",
  "version": "1.1.1",
  "uptimeSec": 3600,
  "database": { "ok": true, "schema": 2 },
  "engine": { "kind": "obs", "connected": true, "streaming": false, "recording": false, "diskFreeBytes": 120000000000 },
  "storage": { "lowDisk": false, "lowSpaceGb": 40 },
  "activeGame": null
}
```

`status` becomes `degraded` when the database cannot be read, or while a game is live and the engine is disconnected or disk space is below the configured warning level.

## Data export

**Settings > Audit and data > Download data export** downloads a JSON file containing games, event logs, venues, destinations, sponsors, airings, profiles, devices, recording metadata, automation, graphics, connectors and the audit log.

Write-only values are removed:

- destination stream keys
- the OBS password and remote access code
- device token hashes
- webhook signing secrets
- connector secrets
- web-request header values and URL query strings

Recording file paths are left out of the export. The export is generated locally and is not uploaded.

## Security headers

API responses send `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `Content-Security-Policy: frame-ancestors 'self'`, and `Cache-Control: no-store` for JSON.
