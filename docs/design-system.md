# Design system — tables, forms, charts

The defaults every screen uses. A live version with sample data is in **Admin → Design**.
Brand: Noise & Notation (chalkboard header, *Fredericka the Great* for display headings,
*Lato* for text, orange accent). Every screen is checked for **WCAG AA contrast in light
and dark mode**; keep it that way when adding UI.

## Tables — `src/ui/DataTable.tsx`

Use `DataTable` for any read-only table. Give it `columns` (`id`, `header`, `value(row)`,
optional `render`, `width`, `align`, `hiddenByDefault`), `rows`, `rowKey`, a stable `tableKey`,
and an `exportName`. Pass `viewStore={useSavedViews(tableKey)}` to enable saved views.

| Feature | Mouse / touch | Keyboard |
|---|---|---|
| Adjustable width | drag a header's right edge; double-click resets | focus the edge, ← → (Shift = ×3) |
| Rearrange columns | drag a header onto another | **Columns & views** → ↑ ↓ |
| Sort | click a header (▲ ▼ / off) | Enter on the header |
| Choose columns | **Columns & views** → checkboxes | same |
| Save a view | **Columns & views** → name → *Save view* (same name updates) | same |
| Density | Comfortable / Compact toggle | same |
| Export | ⬇ CSV / ⬇ Excel — exactly what is shown (visible columns, order, sort) | same |

- The working layout is remembered on the device; **named views are saved to the account**
  (`public.saved_views`, private to each admin).
- Text always wraps, so nothing is truncated in either density. The header row is sticky.
- Exports neutralise text starting with `= + - @` so a comment can never run as a formula.
  Excel cells are written as typed values (numbers stay numbers).
- Editable admin grids (Sessions, Courses, Questions) keep their inline editors and use the
  same visual style.

## Forms — `src/ui/Form.tsx`

- `<Field label hint error required>` wraps any control: visible label above it (never
  placeholder-only), hint and error linked with `aria-describedby`, `aria-invalid` on error,
  "(required)" written in text.
- Validate on blur or submit, not on every keystroke. Error text says how to fix it.
- One primary action per form (orange pill). `<FormActions>` aligns the buttons.
- `<FilterBar>`: one row of filters **above** the content they scope; wraps on phones.
- Touch targets ≥ 44px (inputs 46px).

## Charts — `src/ui/charts.tsx`

Pick the form before the colour:

| Data's job | Use |
|---|---|
| A headline number | `StatTile` in a `KpiRow` (not a chart) |
| Agree ↔ disagree on a 1–5 scale | `LikertChart`, a diverging stacked bar centred on Neutral |
| Change across sessions | `LineChart`, one series; gaps where hidden |

Marks: bars ≤ 20px, 4px rounded data-ends, square at the centre baseline, 2px surface gaps
between segments; lines 2px; markers ≥ 8px with a 2px surface ring; hairline grid and axes.
Text (labels, values, legend) always uses text colours, never series colours. Every chart has
hover and keyboard tooltips (value first) and a **Table view**. Values below the minimum
responses are hidden, never estimated.

### Palette (validated)

Diverging Likert palette, checked with the data-viz validator (OKLab ΔE ×100) against the card
surface in each mode:

| | Strongly disagree | Disagree | Neutral | Agree | Strongly agree |
|---|---|---|---|---|---|
| Light (on `#ffffff`) | `#8f3c0a` | `#e8813f` | `#e1e0d9` | `#5598e7` | `#104281` |
| Dark (on `#1a1a1a`) | `#f7b48a` | `#c4520f` | `#44433f` | `#2a78d6` | `#9ec5f4` |

- Worst adjacent pair: normal vision ΔE 24.5 (light) / 25.1 (dark), floor 15. Colour-vision-deficiency
  simulation ΔE ≥ 15.7, target 8.
- All agree/disagree fills are ≥ 2.75:1 against the card. Neutral is deliberately faint (1.3:1 light),
  so its value is always available from the tooltip, the end figures and the table view.
- Line series: `#2a78d6` (light) / `#3987e5` (dark). Grid `#e1e0d9` / `#2c2c2a`.
- Status (good / attention) always comes with an icon and a word, never colour alone.

To change the palette, edit the `--likert-*` and `--viz-*` tokens in `src/styles.css`, re-run
the validator for both modes, and update this table.
