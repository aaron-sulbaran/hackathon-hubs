# sources/

Raw material, kept exactly as it arrived: the event's official documents (rules, schedule, info packet, opening slides), saved web pages, organizer announcements copied word for word, and meeting or chat notes.

- Add files; never edit or delete one. If a source turns out wrong, add a newer file and say so in the knowledge page that cites it.
- Name each file `YYYY-MM-DD-<slug>.<ext>`, for example `2027-01-15-schedule.pdf` or `2027-01-15-opening-announcement.md`.
- knowledge pages cite what they rely on in their `sources:` frontmatter, for example `sources: [sources/2027-01-15-schedule.pdf]`.
- Agents never read this folder wholesale; they open the one file a knowledge page cites.
- Nothing here ships with the board (`next.config.ts` leaves `sources/` out of the deployment). It is still in the hub repo, so keep secrets out.
