---
title: Playbook
summary: deadlines and the schedule (the board reads it)
kind: how-to
updated:
by:
sources: []
group: logistics
---

# Playbook

The board reads the two sections below for the countdown, the departures board, and the Schedule page. One line per entry: an ISO time with its offset, a title, then `key: value` fields. Until a deadline titled with "submission" or "submit" is listed here, the countdown uses `event.submitBy` from `hub.config.json`; the same goes for `event.startsAt` and a calendar line titled "Hacking starts".

## Deadlines

## Calendar

## Format

Write lines like these under the headings above (lines in this section are not read):

```
- 2027-01-17T09:00-05:00 | Submissions due | kind: deadline
- 2027-01-17T07:00-05:00 | Backup demo video recorded | kind: checkpoint
- 2027-01-15T20:00-05:00 | Hacking starts | kind: event | where: Main hall
- 2027-01-16T12:00-05:00 | Lunch | kind: meal | until: 2027-01-16T13:00-05:00
```

A calendar line without `until:` runs an hour, or until the next one starts.
