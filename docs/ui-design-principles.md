# Spararama UI design principles

These are project-specific design rules derived from direct review of the rendered application. They override generic preferences for decorative or explanatory UI.

## Core principle: reduce cognitive load

Spararama should assume the user already understands ordinary phone-app conventions. Operational screens should not teach obvious interactions or explain familiar visual language.

- Prefer a control that explains itself over help text explaining the control.
- Remove inline text such as “Drag to set the temperature you want” when the affordance is conventional and obvious.
- Put genuinely useful guidance in a separate help/onboarding surface unless it is required at the exact moment for safety or an unfamiliar physical process.
- If the UI needs prose to explain what its colours, shapes, or movement mean, first ask whether the visual design itself is wrong.
- Do not make the user read before they can understand the primary state or action.

## Prefer a complete phone screen over scrolling

Operational screens should fit into one standard phone viewport wherever practical. Scrolling makes poolside use slower and makes it harder to understand the whole state at a glance.

- Treat vertical scrolling as a last resort, not the default way to accommodate a loose layout.
- First reduce padding, repeated headings, explanatory copy, decorative cards and duplicated state.
- Use compact repeated rows for dense tasks such as test-strip entry rather than stacking large cards.
- If more space is genuinely required, prefer horizontal paging or horizontal scrolling over a long vertical page when the information naturally divides that way.
- On mobile, visually hide scrollbars. Leave enough quiet/white space that a finger can drag the surface without needing to grab a narrow scrollbar.
- Horizontal scrolling must not hide the primary action or make a frequently used value difficult to reach.
- Do not make an individual row horizontally scroll just because its contents were given fixed widths; make the row adapt to the available phone width first.
- A screen that technically fits only after the user scrolls past help text has not met this principle.

The target is a complete, glanceable phone workspace. Exceptions are long history/detail views and genuinely large datasets where scrolling is the content, rather than a consequence of inefficient layout.

## Use familiar conventions, not invented visual languages

Use conventions people already know unless there is a strong domain reason not to.

- Blue = cooler and red/orange = hotter are familiar temperature cues.
- Do not introduce arbitrary temperature colours such as green just to make a gradient more colourful.
- A Celsius scale should use sensible, familiar intervals - normally multiples of 10 where a coarse scale is shown.
- Do not spend screen space explaining conventions that are already widely understood.
- Apply domain common sense before aesthetic cleverness.

A useful test: if a designer feels compelled to add a sentence explaining a common control or colour scale, simplify the design instead.

## Prefer restraint over visual effects

Spararama is a practical outdoor control application. It should look confident and clear, not flashy.

- Use the minimum number of visual encodings needed to communicate a fact or state.
- Avoid repeating the same information through several simultaneous effects.
- Do not combine a multicolour track, colour-changing thumb, colour-changing value marker, extra status dot, and explanatory caption for one temperature value.
- A control element hidden under the user's thumb should not carry important visual information.
- Prefer subtle state cues - for example changing the border/accent of a temperature value box - rather than changing several large elements at once.
- Decorative gradients, glow, animation, shadows, badges, and colour changes must earn their place by improving comprehension or interaction.

When in doubt, remove one visual effect and see whether anything useful was lost.

## Legibility without glasses

Assume the user may glance at the phone beside the spa without wearing reading glasses.

- Important numbers and actions should be large, bold, and high contrast.
- Small explanatory text must never carry important operational information.
- Position is part of legibility: the most important value/control should occupy the easiest place to find and reach.
- Do not give prime space to decorative scales, labels, or secondary information at the expense of the control itself.
- Design for bright outdoor light and glare, not just an indoor desktop screenshot.

## Wet hands and clumsy fingers

Assume use on a phone next to a spa, potentially with wet hands, poor fine-motor accuracy, and only one free thumb.

- Make primary touch targets generous and well separated.
- Avoid precision interactions as the only way to perform an important action.
- Where a slider is useful, also provide forgiving ways to make small adjustments when appropriate.
- Place frequently used controls where they are easy to reach rather than where they make a diagram look symmetrical.
- A visually secondary scale should not force the actual interactive control into a worse thumb position.
- Never rely on tiny gaps, handles, icons, or hit targets for frequent poolside actions.

## Temperature-control guidance

Temperature controls are a concrete example of the principles above.

- The numeric current/target temperature is primary.
- Use conventional temperature colour cues sparingly: cool blue through warm orange/red if colour is needed.
- Avoid green in a temperature spectrum unless it has an explicit, independently useful meaning.
- Use sensible Celsius reference marks such as 10, 20, 30, 40 rather than arbitrary intervals.
- Do not duplicate state with a separate coloured dot if the value box/border already conveys it.
- Avoid changing the slider thumb colour if the thumb will be covered during interaction.
- Prefer subtle colouring of the value container/border or track over multiple moving/changing colour elements.
- Put the usable control in the best thumb position; the scale is secondary.
- Do not add text explaining that blue is cooler and red is hotter.

## Copy rule

Before adding helper/explainer text to an operational screen, ask:

1. Is this information safety-critical right now?
2. Is the interaction genuinely unfamiliar or ambiguous?
3. Could the control/layout be redesigned so the text is unnecessary?
4. Could this guidance live in Help/onboarding instead?

If the answer to 1 and 2 is no, prefer redesign/removal over another sentence.

## Review tests for future AI designers

Before calling a UI change complete, explicitly check:

- Can the primary state and action be understood without reading helper paragraphs?
- Does the operational screen fit within a standard phone viewport without vertical scrolling where practical?
- If horizontal overflow is needed on mobile, is the scrollbar hidden and the drag area forgiving?
- Have familiar mobile/domain conventions been used where possible?
- Is any one fact encoded redundantly in colour + icon + animation + text without need?
- Would the important content still be obvious to someone glancing without reading glasses?
- Are primary controls easy to hit with a wet, imprecise thumb?
- Has visual symmetry been prioritised over reachability or usability anywhere?
- Are scales and labels using sensible domain conventions?
- Can any explanatory sentence be deleted because the design now communicates the point itself?

The target is a simple, restrained, self-explanatory instrument panel - not an interface that needs to narrate how to use itself.
