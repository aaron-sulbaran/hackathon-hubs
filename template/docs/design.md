# Board design

The board's look is an example theme: cream paper, navy ink, and pastel pink, peach, sky, mint, and butter, with a light travel theme (a departures board for the countdown, a boarding pass per teammate). It is a tool for a small team, so the travel idea shows up only where it carries information. To give the board your event's colors, change the tokens in `app/globals.css`; every component refers to them by name. To use your event's logo, replace `app/icon.svg` (only with a file you may redistribute).

Every drawing in the app is inline SVG drawn for it. Lexend and Doto come from Google Fonts through `next/font` (open licenses, served from the deployment).

## Tokens

CSS variables on `:root` in `app/globals.css`, swapped under `prefers-color-scheme: dark`, mapped into Tailwind (`bg-card`, `text-ink-2`, ...). Light is "paper"; dark is "night flight".

| Token | Light | Dark | Use |
|---|---|---|---|
| wash | `#F3EEE9` | `#121829` | page |
| card | `#FFFCF8` | `#1A2238` | cards, header, tab bar |
| card-flat | `#F7F1EA` | `#232C47` | insets, inputs, tiles |
| divider | `#E4DAD0` | `#323C5C` | borders, rules |
| hairline | navy at 12% | cream at 10% | the 1px edge on cards |
| ink | `#26345B` | `#F3EEE9` | text |
| ink-2 | `#565E80` | `#B3BAD3` | secondary text (5.5:1 and 8:1) |
| primary | `#334169` | `#A8C4F0` | buttons, active nav, done disc |
| on-primary | `#FFFCF8` | `#121829` | text on primary |
| link | `#3E5BA0` | `#A8C4F0` | links |
| tint | `#E5EEFB` | `#26355C` | selected rows, chips |
| rose | `#9C4A59` | `#E9A6B1` | the one attention color: the "Needs you" count |
| board | card | `#0D1220` | the departures board panel (paper in light, night in dark) |
| board-tile | `#26345B` | `#1C2540` | a departure digit's tile |
| board-tile-ink | `#F7E3C4` | `#F2C89D` | a departure digit |

Contrast: every text pair above is at least 4.5:1 (ink on wash 10.6:1, ink-2 on wash 5.5:1, rose on card 5.8:1, on-primary on primary 9.8:1).

**Map groups** (the knowledge graph; identity, never status). Pastel fills with a navy outline in light, a card-colored outline in dark, so the 1.5px edge carries the 3:1 contrast the fill alone would not:

| Group | Fill | What is in it |
|---|---|---|
| Rules and judging | rose `#E7AAB4` | rules, judging, open questions |
| Tracks | peach `#F2C89D` | the track overview and every sponsor track |
| Ideas | sky `#A9C9EE` | ideas, the shortlist, past winners |
| Team | mint `#BCD9C6` | the team, how we work, lessons, prior art, the project repo, and each person |
| Logistics | butter `#F3DA97` | the playbook, logistics, hardware |

**People** keep one accent everywhere (avatar, boarding pass, map), picked from six pastels by a hash of their id (`lib/web/people.ts`), each with navy initials.

**Type.** Lexend (Google Fonts, through `next/font`) for all text; Doto, a dot-matrix face, for the departure digits only. Weights 400, 500, 600, 700. Sizes 12, 13, 15 (body), 17 (card title), 20, 24 (page title), 40 (departures digits). Numbers that tick or line up use tabular figures. Sentence case everywhere, including headings and buttons; no all-caps labels.

**Shape.** Card radius 14px with a 1px hairline edge and almost no shadow. Controls 10px. Chips and pills fully round. Departure digit tiles 6px.

**Spacing.** A 4px base: 4, 8, 12, 16, 20, 24, 32. Cards pad 16px on phones and 20px from 640px up. The page gutter is 12px on phones and 16px from 640px.

**Motion.** Enter `cubic-bezier(.14,1,.34,1)`, exit `(.45,.1,.2,1)`, move `(.17,.17,0,1)`, pop `(.34,1.56,.64,1)`. A departure digit that changes turns down once (220ms, `flap`). The plane on the flight path sits where the clock says; it never animates on its own. Under reduced motion every entrance is a short fade, nothing turns or loops, and the check is already drawn.

## Travel, only where it carries information

1. **The departures board is the countdown.** Home shows one panel (paper in light so the map stays the heaviest thing on the page, night navy in dark) with digits on navy tiles: time left to the submission deadline in large tabular digits, the deadline's name and time, a dashed flight path from the start of hacking to the deadline with a plane at the share of time used, and the next deadlines as rows (time, what, where, time left). A passed deadline reads "Departed" with a drawn check. All of it comes from `kb/playbook.md`, with `event.startsAt` and `event.submitBy` from `hub.config.json` filling in when the playbook has no such lines.
2. **Each teammate's current work is a boarding pass.** One pass per person: who, what they are working on (open session focus, else latest pulse), the branch, how many files, and when they last posted. The stub holds their presence, told by shape: a solid ring (working now), a dashed ring (idle 45 minutes), no ring (away). File overlaps between two people sit above the passes, because that is the warning that matters.
3. **The schedule is an itinerary,** at every width: times down the left, a dashed route with a stop for each entry (a ring for an event, a filled diamond for a deadline, an outlined diamond for a checkpoint), the room beside the title. The countdown is not repeated there.
4. **Tracks are a group on the map,** not a separate metaphor: the map already places every track page in one cluster.

Nowhere else: no stamps, no passports, no clouds behind text, no plane cursor, no "now boarding" copy on things that are not deadlines.

## The home page

In order, on every width: the knowledge graph map (the first thing on the page), time left (the departures board), what needs you (questions for you or the team, your onboarding task), and who is on what (the boarding passes). The activity feed, items, mentor questions and design reviews live on their own pages. At 1440px the map takes the wide left column and the other three stack in a 400px right column.

## The knowledge graph

Every `kb/` page is a node, every `[[kb/...]]` link an edge. People always attach; open items and questions attach only when they link a page (the rest live on Board). Nodes sit in five labeled clusters (the groups above) around the index, so the map teaches the event before anyone taps it. A page may set `group:` in its frontmatter; otherwise its slug decides (`track-*` goes to Tracks), and a new page with no rule joins the group most of its links point to. Two fixed layouts, both deterministic and server rendered: a wide one and a phone one, picked by CSS. Hover, focus or a first tap lights a node and its neighbors and names it in the caption (above the map on phones, under it from 768px); a second tap or the Open button opens the page. The same pages, grouped the same way, are a plain list under the map.

## Status and the few rules

1. **Status is shape first, never red or amber.** Open is a hollow ring, proposed is a half filled ring, done is a filled disc with a check that draws itself, failed is a ring with a slash. Every glyph has a text label or an aria label.
2. **No emoji, as status or decoration.** Icons are the line set in `components/icons.tsx`.
3. **People lead, agents sit behind.** A line names the person first; the agent tool is a small line under it.
4. **Every input has a visible label, and every write shows a receipt** ("Saved to the hub" or the error). When web writes are off (no `HUB_WRITE_TOKEN`), the controls say so before anyone presses them.
5. **Empty states say what will appear and how it gets there.**
6. **"Needs you" is the one place a person acts.** Navigation holds Home, Board, Schedule, Knowledge. Decide and Design stay reachable from links but are not tabs.
