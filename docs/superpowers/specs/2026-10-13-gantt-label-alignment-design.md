# Gantt Timeline Text: Alignment, Beside-Bar Positions, Auto-Fit, Contrast, Font Style

Date: 2026-10-13
Scope: `NovaPlan.html` (single-file app), new Playwright spec, README/help text.

## Problem

1. Timeline text has a vertical position (above / middle / below) but no horizontal
   alignment. Text above or below a bar always starts at the bar's left edge, and text
   inside a bar is always centred.
2. Text cannot be placed beside a bar, which is the only readable spot for short bars.
3. Inside text that does not fit is truncated to `Tit...`, or hidden entirely when the
   bar is narrower than 24px. Fit is guessed at 7px per character.
4. Inside text is always white, which is unreadable on light bar colours.
5. Text size and weight are fixed (11px; bold only when inside).

## Goals

- Left / centre / right alignment of timeline text relative to the bar.
- `before` and `after` positions that place text beside the bar.
- Inside text that does not fit moves beside the bar instead of being cut.
- Inside text colour chosen automatically for contrast when no colour is set.
- Per-label font size, bold and italic.
- Plans saved before this change render exactly as they do today, except for the
  overflow behaviour described in section 3.

## Non-goals

- Data tokens in label text (`{progress}`, `{start}`, ...).
- Background halo or pill behind text.
- Bulk apply or copy of label style across tasks.
- Changing row height to make room for larger text.

## Design

### 1. Data model

Four new `tasks` columns. An empty value means "use the default".

| Column | Values |
|---|---|
| `gantt_label_align` | `left`, `center`, `right` |
| `gantt_label_size` | `s`, `m`, `l` |
| `gantt_label_bold` | `1`, `0` (empty = automatic, see section 5) |
| `gantt_label_italic` | `1` |

`gantt_label_position` gains two values, `before` and `after`, in addition to
`above`, `below`, `middle`.

New constants next to `GANTT_LABEL_POSITIONS`:

- `GANTT_LABEL_ALIGNS = ["left", "center", "right"]`
- `GANTT_LABEL_SIZES = { s: 9, m: 11, l: 13 }` (pixels; `m` is today's size)
- `GANTT_TASK_LABEL_POSITIONS = ["above", "middle", "below", "before", "after"]`,
  replacing the three inline `["above", "below", "middle"]` literals.
- `GANTT_LABEL_POSITIONS` (global setting) becomes
  `["inside", "middle", "above", "below", "before", "after"]`.

`DEFAULT_GANTT_LABELS` becomes
`{ source: "task", position: "inside", align: "", size: "m", overflow: "outside" }`.
`align: ""` means automatic (section 2). `overflow` is `outside` or `truncate`.

Columns are added to the `CREATE TABLE` statement and to the `ALTER TABLE` migration
list. The row normaliser validates each value and falls back to empty.
`loadSettings` validates the three new `ganttLabels` keys the same way it validates
`source` and `position`.

### 2. Placement

A new pure function on `GanttChart`:

```
ganttLabelLayout({ x, y, w, position, align, isMilestone })
  -> { x, y, anchor, inside }
```

`x`, `y`, `w` are the bar's left edge, top and width. `anchor` is the SVG
`text-anchor` (`start`, `middle`, `end`). `inside` is true when the text sits on the
bar.

Horizontal rules, with `PAD = 6`:

| Position | Align | Label x | Anchor |
|---|---|---|---|
| above, below | left | `x` | start |
| above, below | center | `x + w/2` | middle |
| above, below | right | `x + w` | end |
| inside, middle | left | `x + PAD` | start |
| inside, middle | center | `x + w/2` | middle |
| inside, middle | right | `x + w - PAD` | end |
| before | (ignored) | `x - PAD` | end |
| after | (ignored) | `x + w + PAD` | start |

Automatic alignment (`align` empty) resolves to `left` for above/below and `center`
for inside/middle. That is today's behaviour.

Vertical rules: above `y - 3`; below `y + BAR_HEIGHT + 8`; inside, middle, before and
after `y + BAR_HEIGHT / 2 + 4` with `dominant-baseline: middle`. That is the value
inside text uses today, so existing plans do not shift and beside-bar text lines up
with inside text.

Milestones: the caller passes the diamond's bounds as the bar (`x = cx - 12`,
`w = 24`). `inside` and `middle` resolve to `after`, because a diamond cannot hold
text. Above/below then align against the diamond.

`ganttLabelNode` calls `ganttLabelLayout` and applies the result. The drag preview in
`dragMove` calls the same function with the bar's live `x` and `w`, replacing the four
duplicated label-x blocks. This also fixes the current mismatch where a dragged
milestone label jumps to the diamond centre while the rendered label sits at
`cx + 14`.

The effective position and alignment used at render time are stored on the label
element (`data-position`, `data-align`) so the drag preview reuses them rather than
re-deriving them from the task.

### 3. Auto-fit overflow

`ganttLabel(task, width)` decides fit before layout:

1. Resolve position, alignment, size, bold, italic, font.
2. If the position is inside/middle, measure the text with a cached canvas 2D context
   (`measureText`) using the resolved font string.
3. If the measured width exceeds `width - 2 * PAD`:
   - overflow mode `outside`: the position becomes `after` and the text is treated as
     outside text (theme colour, 36-character cap).
   - overflow mode `truncate`: trim characters until `text + "..."` fits; if not even
     one character fits, show nothing. This matches today's result but uses measured
     width instead of the 7px estimate.
4. Outside text (above, below, before, after) keeps the existing 36-character cap.

The overflow mode is a global setting, default `outside`. This is the one visible
change for existing plans: long inside labels now appear to the right of the bar.

Fit is not re-evaluated while dragging or resizing. The refresh after drop re-runs it.

### 4. Auto-contrast

For text that ends up inside the bar with no custom colour, the fill is `#111111`
when the bar's base colour (the `color` value used to draw the bar, before the
progress overlay darkens it) has a WCAG relative luminance above `0.35`, otherwise
`#ffffff`. The threshold is deliberately biased towards white: the default blue,
purple and red task colours and grey summary bars keep white text as today, and white
stays readable over the darkened progress overlay. Only clearly light bars (yellow,
green, cyan, orange, light grey) switch to dark text. A custom `gantt_label_color`
always wins. Outside text keeps `--text-primary`.

Implemented as a small pure helper `contrastTextColor(hex)`; a colour that is not
`#rrggbb` returns `#ffffff`.

The timeline text dialog currently stores `#e6edf3` as an explicit colour on every
save, which would defeat this. The dialog now stores a colour only if the task
already had one or the user changes the colour picker; otherwise it stores empty
(automatic).

### 5. Font size, bold, italic

`ganttLabelNode` sets `font-size` from `GANTT_LABEL_SIZES`, `font-weight: 700` when
bold, `font-style: italic` when italic.

Bold is tri-state so existing labels keep their look. `gantt_label_bold` empty means
automatic: bold when the text sits inside the bar, normal otherwise, which is today's
behaviour. `1` forces bold and `0` forces normal. Tasks without custom text always use
automatic. The dialog shows Bold pressed when the effective value is bold. It stores
`1` or `0` only once the user clicks Bold; until then the flag stays empty, so the
button follows the chosen position. Italic has no automatic state: empty means off.

A task with custom text and an empty alignment or size falls back to the global
default alignment and size.

Row height is unchanged. Large text above or below a bar can touch the neighbouring
row; that is accepted.

### 6. UI

**Timeline text dialog** (`showGanttTimelineTextDialog`):

- Position row: Above, Middle, Below, Before, After.
- New Align row: Left, Center, Right. Same toggle-button pattern as Position. No
  button pressed means automatic; clicking the pressed button un-presses it. The row
  is disabled when Position is Before or After.
- Style grid gains a Size select (Default, Small, Medium, Large) and Bold / Italic
  toggle buttons.
- The dialog result and `editTimelineText` carry `align`, `size`, `bold`, `italic`.
  Clear resets all label fields to empty.

**Gantt Label Settings** (`editGanttLabelSettings`):

- Position list gains Before and After.
- New selects: Default alignment (Automatic, Left, Center, Right), Default text size
  (Small, Medium, Large), Text too long for bar (Move outside, Truncate).
- `saveSetting("ganttLabels", ...)` stores all five keys.

Precedence is unchanged: a task's own position, alignment, size, bold and italic
apply only when the task has custom timeline text. Tasks without it use the global
settings. Colour and font keep their current behaviour.

**Grid column edit**: editing the `Gantt Text` cell still defaults a new label to
`above`; no change.

### 7. Import / export

Excel export adds `Gantt Text Align`, `Gantt Text Size`, `Gantt Text Bold`,
`Gantt Text Italic` after `Gantt Text Font`. Size is exported as `s` / `m` / `l`,
bold and italic as `Yes` / `No` / empty. Import accepts the same headers plus the
snake_case column names, case-insensitive values, `yes` / `true` / `1` as on and
`no` / `false` / `0` as off.
`Gantt Text Position` accepts `before` and `after`. Unknown values import as empty.

### 8. Docs

The in-app help section on timeline text and the README feature list describe
alignment, beside-bar positions, overflow behaviour and text style.

## Testing

New `tests/gantt-label-alignment.spec.js` (Playwright, same setup as the existing
specs):

- For above, below and middle: left / center / right produce the expected
  `text-anchor` and an `x` at the bar's left edge, midpoint and right edge (with
  padding for middle).
- Unset alignment gives left for above/below and centre for middle.
- `before` ends left of the bar; `after` starts right of it.
- A long title on a short bar with overflow `outside` renders after the bar and is
  not truncated; with overflow `truncate` it stays inside and ends in `...`.
- Inside text on a light bar is dark, on a dark bar is white; a custom colour is kept.
- Size, bold and italic set `font-size`, `font-weight`, `font-style`.
- Settings survive a reload.
- Dragging and resizing a bar keeps the label at the aligned edge.
- A milestone with position middle renders its label after the diamond.

The existing specs must still pass.
