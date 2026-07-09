---
name: clima
description: Fetch local weather from the command line via wttr.in (no API key). Use when the user asks for the weather, forecast, temperature, or conditions for their location or a named city. Triggers: "clima", "tiempo", "weather", "forecast", "temperatura", "¿va a llover?".
---

# Weather

Fetch weather locally with `curl` against [wttr.in](https://wttr.in). No API key, no dependencies.

## Location

- No city given: default to `Colindres,Cantabria,Spain` (URL-encoded `Colindres,Cantabria,Spain`). Do NOT geolocate by IP.
- City given: URL-encode it (`New York` -> `New+York`).
- Airport/region also work (`~Eiffel+Tower`, `muc`, `SFO`).

## Commands

Current conditions + 3-day forecast (default view, default location):

```bash
curl -s "https://wttr.in/Colindres,Cantabria,Spain?m"
```

Named city:

```bash
curl -s "https://wttr.in/Madrid?m"
```

One-line summary (good for quick answers / status bars):

```bash
curl -s "https://wttr.in/Madrid?format=%l:+%c+%t+%h+%w&m"
```

Format tokens: `%l` location, `%c` condition icon, `%t` temp, `%f` feels-like, `%h` humidity, `%w` wind, `%p` precip, `%m` moon.

## Flags

- `?m` metric (Celsius, m/s). Use `?u` for imperial (default is metric outside US).
- `?0` current only, `?1`/`?2` one/two-day forecast.
- `?T` no ANSI colors (cleaner when piping/parsing).
- `?lang=es` Spanish descriptions.

## Steps

1. Run the `curl`. Prefer `?m?T?lang=es` for parseable metric output.
2. If curl fails (no network, `000`), report it plainly — do not invent data.
3. Report temp, condition, feels-like, wind, precip chance. Concise.

## Note

wttr.in is a third-party public service. Requires network. Rate-limited if hammered — one call per request.
