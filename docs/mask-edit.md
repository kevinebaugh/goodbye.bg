# Mask editing (prototype 2026-11-21; merged into main 2026-11-22 after a third rebase, onto 6345b90)

remove.bg has an erase/restore brush; we didn't. The 1,073-photo test (`docs/quality-1000.md`) says what goes wrong:
BiRefNet keeps the wrong thing (a blanket, hands), ISNet drops or fades a piece of the subject (a tail, a dark body).
Both are fixed fastest by a tap on the piece, and a brush covers the rest.

## Getting in

- **The pencil in the card's bar** (third rebase, 2026-11-22). Main now uses a tap on a finished photo to put it on the
  product cards (809b37a), so a tap on the cut-out no longer opens the editor. Bar order: crop, pencil, background,
  Download, 👍 👎, remove. The pencil takes its own width tier so no existing breakpoint moves: in the one-row bar from
  280 px card width (Download keeps 48 px or more there), in the roomy two-row bar (phones in portrait) from 184 px
  (five 32 px controls in the second row). Anywhere narrower it rides along in the background picker (`wantedit`, the
  same way crop, remove and the votes do), so it is never lost.
- Not for animated GIFs, failed cards, or a card that is working (a 👎 retry).
- **Keyboard:** the pencil is a button (Enter or Space). A finished cut-out is also in the tab order ("Edit cut-out"):
  Enter or Space on it opens the editor. Either way Done gets focus, and Escape or Done puts focus back where it came
  from (the pencil, the cut-out, or the background button when the pencil sat in the picker). A mouse click on the
  cut-out is main's product-card tap. The brush and Pieces still need a pointer.
- **Pinch:** main blocks pinch on the page (`body.app * { touch-action: pan-x pan-y }`, early.js cancels Safari's
  gesture events). The stage sets `touch-action: none` (as `body.app .estage`, so it wins whatever order the sheets
  load in) and edit.js handles two pointers itself, so the editor still pinches and pans. Safari's cancelled gesture
  events don't touch pointer events. The page's double-tap guard no longer tries to cancel an uncancelable touchend
  (the end of a pinch). Checked with CDP touch events in headless Chrome; untested in real Safari.
- **Words:** every string in the editor goes through `GB.t` (app.js passes `t` in). The new ones are in `src/i18n.js`
  with English values until the translation pass (`docs/i18n.md`, Pending).

## The edit view

The edit view takes the grid's place inside `main` (the grid, Download all and the footer hide; the header stays).
One screen, no scrolling. Nothing overlaps the image: the photo fills the stage and the tools sit in one bar under it.

- The stage shows the **whole frame** (not the crop), so pieces outside the current crop can come back.
  Kept parts are the photo; dropped parts are the photo faded to a ghost over the checkerboard, so you can see what
  you could bring back.
- Bar: **Pieces | Erase | Restore**, then the brush size (or, in Pieces, a short hint), **Undo**, **Done**.
  Narrow screens show the icons without the words.

### Tap a piece (Pieces)

- On a kept part: the connected piece (alpha at least 64, as despeck counts pieces) and its soft fringe are dropped.
- On a dropped part: the connected stretch of what the model was **unsure** about is brought back. The page now keeps
  the model's raw output (before despeck and the edge curve) as 1 byte a pixel, deflated (13 to 51 KB a photo in tests), so a
  faded tail or a despeckled island comes back with its soft edge. Rules so a tap can't flood the scene: the tap
  must land on a pixel the model gave at least 0.12; growth continues through pixels over 0.05 (hysteresis); it stays
  3 px clear of the kept subject (so the subject's own edge isn't hardened) and is then grown back over that gap; a
  region over 40% of the photo is refused.
- Where there is no raw output (photos kept before this change) or the tap lands on clean background, a colour wand
  picks the similar-coloured connected dropped area instead, with the same size cap.
- A refused tap gives a small shake; a piece that goes or comes back fades.

### Brush (Erase, Restore)

- Round, soft-edged, sized in screen pixels (so zooming in gives a finer brush). The size slider runs 6 to 120 px; a
  ring follows the mouse. Strokes are stamped along the path, so fast strokes have no gaps.
- **Pinch-zoom friendly:** on the stage, two fingers zoom and pan the photo (the page itself doesn't zoom there;
  `touch-action: none` only on the stage). One finger paints; the stroke waits a moment so the start of a pinch
  doesn't paint. Mouse: wheel or trackpad pinch zooms at the pointer; right-drag or space-drag pans.

### Undo, Done

- Undo steps back one tap or stroke, back to the result you opened (Cmd/Ctrl+Z too; in the editor it never undoes a
  Remove). Snapshots of the alpha only, 1 byte a pixel, at most 48 MB.
- Done (or Escape) keeps the edits and goes back to the grid. No Cancel: Undo back to the start does that.

## Resolution

The editor works on a mask with the photo's proportions (square pixels, so a round brush is round), its long side
2048 px or the photo's, whichever is smaller. A 24 MP photo (6000x4000) is edited at 2048x1365 and scaled up on
Download, like the model's 1024 mask is today. The photo shown is the card's preview bitmap (at most 1600 px); the full
photo is never decoded for editing.

## Where the edit goes

Done builds a **new** mask canvas (the PNG and ad-art caches are keyed by the mask object), carries over the
edge-colour layer (cleared where the edit changed the mask, so edited parts show the photo itself), recomputes the subject box at 1024, and then everything that reads `it.mask` follows: the card
preview and crop box, Download (PNG, or JPG with a background), Download all, the ad cards showing that photo (redrawn),
the cut-out sent to Zazzle, and the IndexedDB record (mask PNG, raw output, `edited` flag), so it survives a reload.
Since the rebase onto main (2026-11-22): the background picker's colour, blur (made from the new mask: the blur cache is
keyed by the mask object) and your own photo; Size, Margin, Shadow and WebP (they place the cut-out by the new subject
box); the streamed Download all; and offline (`edit.js` and `edit.css` are in the service worker's shell list in
`scripts/build.mjs`). The editor itself shows the cut-out on the checkerboard, not on the chosen background.
`npm run test` has a check for it (`editing: ...`). It makes a real click on the cut-out (which must not open the
editor), then a real click on the pencil, and erases three strokes. It checks that the spot is clear in the PNG, white
in the JPG, in Download all and still white after a reload, that Square is square, that Enter on the cut-out and on
the pencil opens it with Done focused and Escape puts focus back, and that a two-finger pinch zooms the stage (5x) while
the page stays at scale 1. It reads positions only once the grid holds still (main centres a short last row).
Erasing everything is allowed: the card then has no subject (whole frame, nothing kept), like any result without one.

## Edits win over 👎

Once a photo is edited, 👎 is a vote only (label "Bad result"): no zoomed retry and no "second 👎 brings the first
result back", because both would throw the edits away. Editing after a retry starts from the merged retry result and
forgets the first result. The vote stays as it was (it rates the model, not the edit).

## Not in this prototype

- A "back to the model's result" button (Undo covers it within one edit session).
- Edge refinement (hair) and a hardness control.
- Counting edits (could tell us which engine needs them most; would be one more anonymous count).
