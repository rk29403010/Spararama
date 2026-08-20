---
name: spararama-ui-ux
description: Design, implement, or review Spararama frontend UI/UX. Use for React/TSX/CSS changes, new screens, workflow changes, controls, dashboards, chemical testing/dosing flows, responsive work, accessibility, or visual redesigns.
version: "1.0"
---

# Spararama UI/UX

Treat Spararama as a **touch-first outdoor control and guidance application**, not a generic dashboard.

The primary design goal is to let someone understand the spa state and perform the next useful action with the least possible thought, tapping, typing, memory, and hand coordination.

Functional correctness, accessibility, responsive behaviour, and honest system state are hard gates. A prettier interface that makes the primary task harder is a regression.

## Product context

Design for these real conditions:

- Primary use is on a phone beside an outdoor hot tub.
- The phone may be in bright sunlight, with glare and reduced apparent contrast.
- Hands may be wet; fine pointer accuracy cannot be assumed.
- A user may be holding a test strip, chemical bottle, spoon, cover, or phone at the same time.
- Many actions are performed standing up and should work comfortably one-handed.
- Chemical testing includes timed steps where the user must not feel rushed by the interface.
- Spa connectivity is optional. Manual-only, configured-but-unreachable, live, stale, and partial-data states are normal product states rather than exceptional crashes.
- The user may leave a workflow part-way through and return later.
- Chemical readings can be uncertain, ranges, or deliberately recorded as unknown.
- The application contains operational information, so clarity beats visual novelty.

## Design mode

Spararama is primarily an **operational product/workspace with monitoring and guided workflows**.

Use a calm, purposeful visual language. It should feel more like a well-designed poolside instrument/control panel than a marketing site.

Distinctiveness should come from the spa/testing domain, useful visualisation, excellent hierarchy, and polished interaction - not decorative gradients, glass effects, giant hero sections, excessive cards, or gratuitous animation.

## Before changing a UI

Inspect the relevant existing screen and nearby components first. Do not redesign an isolated component without understanding its surrounding hierarchy and interaction pattern.

For any substantial UI change, privately establish:

1. **User:** who is using this screen and under what physical conditions?
2. **Primary job:** what is the one thing they most need to understand or do?
3. **Next action:** what should be visually obvious without reading everything?
4. **State model:** what live, stale, offline, loading, unknown, success, failure, interrupted, and partial states can really occur?
5. **Input burden:** can taps, typing, confirmation steps, or choices be removed?
6. **Visual thesis:** one sentence describing the intended hierarchy and feel.

Do not begin by choosing colours, card styles, or animation.

## Interaction principles

### Minimise effort

- Prefer one obvious action over a row of equally weighted choices.
- Remove taps that only advance time or acknowledge something the system already knows.
- Do not require the user to start a timer after an action that itself starts the real-world timing.
- Preserve entered data when navigating, losing connection, or recovering from errors where practical.
- Use sensible defaults from known context; do not make users repeatedly re-enter stable information.
- Avoid typing where tapping, selecting, incrementing, or reusing a previous value is safer and faster.
- Progressive disclosure is preferred to presenting every option at once.

### Touch first

- Frequent touch controls should normally provide at least a 44 x 44 CSS-pixel effective target, preferably larger for primary poolside actions.
- Leave enough separation that wet or imprecise taps do not trigger neighbouring actions.
- Never make a tiny icon the only target for an important action.
- Avoid interactions that require hover, precision dragging, double-clicking, or multi-finger gestures.
- Design important tasks to work one-handed on a narrow phone.

### Timed workflows

For guided testing, dosing, heating, bathing, and similar real-world processes:

- Treat the workflow as an event with explicit phases rather than a sequence of unrelated modal screens.
- Tell the user what they will need before timing begins.
- Give instructions early enough for a human to read and physically respond.
- If time is already passing in the real world, start the app timer automatically rather than asking for another tap.
- Show countdowns only where the remaining time is useful.
- Use animation to demonstrate physical action when it genuinely reduces ambiguity - for example, a strip dipping in/out or being held horizontally.
- Make resume/recovery behaviour explicit when the app loses focus, reloads, or is left unattended.
- Do not manufacture urgency. A user handling chemicals should feel guided, not hurried.

## Information hierarchy

The home screen and operational screens should generally answer, in this order:

1. **Can I use the spa / what is its important current state?**
2. **What is happening now?** Heating, filtering, dosing event, bathing event, test in progress, offline, etc.
3. **What should I do next?**
4. **What supporting detail might I want?**

Make current state and primary action visually dominant. Historical/detail information should not compete with them.

For measurements:

- Always show units where ambiguity is possible.
- Show freshness/source when it matters.
- Unknown is not zero.
- Stale is not live.
- Estimated/inferred is not measured.
- Ranges must remain ranges rather than being silently collapsed to a midpoint.

Compact labelled pills/chips are appropriate for glanceable readings when several measurements must be scanned together, provided they remain readable and are not used as decoration.

## Chemical testing and dosing

Chemical workflows require extra care because the app is supporting physical actions.

### Test-strip result entry

Where manual strip results are selected from bottle-style colour references:

- Visually resemble the real comparison task: colour swatch plus its printed reading/range.
- Provide an explicit **Don't know / Can't match** choice.
- Allow a value/range to represent a tap between adjacent swatches when the product workflow requires it.
- Make the selected state unmistakable without relying on colour alone.
- Do not imply that on-screen colours are calibrated reproductions of the physical bottle.
- Preserve uncertainty in stored/displayed data rather than inventing precision.

### Dosing

- Present dosing as a coherent event: add chemical -> circulate/wait -> optionally retest -> next step/completion.
- Show the current step, what was already added, and what is expected next.
- Keep amounts and units visually prominent.
- Distinguish advice from an action that has actually been logged/performed.
- Make accidental duplicate dose logging difficult.
- If a dosing event becomes abandoned or uncertain, record that uncertainty instead of pretending completion.

## Visual system

Before adding new styling, inspect the existing tokens, Tailwind usage, common component patterns, iconography, typography, and spacing. Reuse coherent patterns; remove drift rather than creating another parallel style.

### Hierarchy

- Typography, spacing, grouping, and placement should do most of the hierarchy work.
- Use borders, shadows, colour blocks, and cards only when they clarify grouping, state, or affordance.
- Avoid turning every piece of information into a separate card.
- Use whitespace deliberately but do not waste scarce mobile height.
- Keep line lengths comfortable and labels short.

### Colour

- Design for outdoor glare and maintain strong contrast.
- WCAG 2.2 AA is the baseline: 4.5:1 for normal text, 3:1 for large text, and appropriate non-text contrast for controls/meaningful graphics.
- Never encode status only by colour; pair it with text, icon, shape, position, or another cue.
- Use warning/error colours sparingly so they retain meaning.
- Do not use chemical swatch colours as general UI status colours if that could confuse the comparison task.

### Typography and icons

- Prioritise legibility over novelty.
- Data should use typography that makes numbers easy to compare.
- Icons must reinforce meaning rather than substitute for unclear labels.
- Important unfamiliar actions should have text labels even if an icon is also present.

### Motion

- Motion should explain state or physical action, not decorate the screen.
- Respect `prefers-reduced-motion`.
- Avoid long transitions that delay interaction.
- Do not animate continuously unless the movement conveys genuinely live state and the value outweighs distraction/battery cost.

## Responsive behaviour

Mobile is the primary design target, but do not merely stretch the mobile UI onto desktop.

At minimum verify:

- narrow phone portrait;
- wider phone/tablet;
- desktop/laptop;
- enlarged text/zoom where feasible.

Preserve priority and reading order as layouts reflow. Do not hide essential controls just to make a narrow screenshot cleaner.

Avoid horizontal scrolling for ordinary application content. Where horizontal scrolling is semantically useful, such as a time series, make that behaviour obvious and keep key actions outside the scroller.

## Accessibility

Use semantic HTML first.

Required:

- visible keyboard focus;
- keyboard-operable controls;
- accurate labels and accessible names;
- labels/errors/instructions associated with inputs;
- no essential hover-only information;
- no colour-only meaning;
- usable zoom/reflow;
- meaningful asynchronous status announcements where needed;
- correct focus handling for dialogs/overlays;
- reduced-motion support;
- sufficient target size and separation.

Do not add ARIA as decoration. Use it only where native semantics are insufficient and behaviour is implemented correctly.

## Copy

Write from the user's side of the spa, not from the software architecture.

- Prefer plain, concrete verbs: **Start test**, **Getting in**, **Getting out**, **Add dose**, **Save reading**.
- Keep the same action name through the flow.
- Avoid technical implementation language unless the user is in a diagnostic/configuration area.
- Error text should say what happened and what the user can do next.
- Do not apologise, market, or add filler copy.
- A label labels; supporting text explains only what is genuinely unclear.

## System states

For every feature changed, consider the states that can genuinely occur. Relevant examples include:

- initial / first use;
- loading;
- live;
- stale;
- offline;
- adapter configured but unreachable;
- partial response;
- unknown measurement;
- empty / no history;
- success;
- validation error;
- server/network error;
- disabled/busy;
- in-progress event;
- interrupted/abandoned event;
- retry/recovery.

Never display a successful or live-looking state merely because it is visually convenient.

## Implementation discipline

- Reuse existing components before creating near-duplicates.
- Keep domain state separate from presentation-only state.
- Do not move CleverSpa protocol or hardware logic into React components.
- Do not perform broad architecture refactors as collateral damage from visual work.
- Do not add a UI framework merely to improve one screen.
- Prefer the existing React/Tailwind/Lucide/Motion stack unless there is a clear, approved reason to add a dependency.
- Keep animations and visual effects cheap enough for an ordinary phone.

## Required workflow for substantial UI work

### 1. Inspect

Read the relevant components, current styles/tokens, and the page containing them. Understand the real data/state model before designing.

### 2. Simplify the task

Identify unnecessary decisions, taps, typing, acknowledgement screens, modals, and information competing with the primary task. Remove these before adding visual polish.

### 3. Design

Privately sketch at least two plausible layouts/interactions for a substantial screen change. Choose based on task fit rather than novelty.

Spend distinctiveness in one or two useful places. Keep the rest disciplined.

### 4. Implement complete states

Do not implement only the ideal screenshot. Cover the relevant real states and responsive behaviour.

### 5. Render and inspect

**Source code compiling is not visual verification.**

When browser tooling is available:

- run the real application;
- inspect the actual rendered screen;
- capture screenshots at representative phone and desktop widths;
- exercise the primary interaction, not just the initial state;
- inspect long text, unknown/stale/offline states when relevant;
- check keyboard focus and touch target behaviour;
- fix visual defects found, then inspect again.

If rendered verification cannot be performed, say so explicitly. Never claim that a UI "looks good" based only on source inspection.

### 6. Critique

Before considering the change complete, ask:

- Is the primary action obvious in under a second?
- Is anything visually prominent that does not deserve to be?
- Can one control or piece of explanatory text be removed?
- Can this be used with wet hands and one free thumb?
- Does it remain understandable in bright light?
- Are unknown/stale/offline states visually honest?
- Does it look like one product rather than a collection of generated components?

## Review checklist

A UI change is not complete until the relevant items pass:

- [ ] Primary task and next action are obvious.
- [ ] Number of taps/choices/typing has not increased without justification.
- [ ] Frequent touch targets are comfortably sized and separated.
- [ ] Mobile portrait works without clipped or hidden essential controls.
- [ ] Desktop/tablet uses the available space sensibly.
- [ ] Loading/unknown/stale/offline/error states are honest and usable.
- [ ] Colour is not the sole carrier of meaning.
- [ ] Text/control contrast is adequate.
- [ ] Keyboard focus is visible and logical.
- [ ] Motion is purposeful and reduced-motion safe.
- [ ] Existing design patterns/components are reused or deliberately improved.
- [ ] The rendered result has been inspected where tooling allows.
- [ ] Any unverified visual/accessibility behaviour is reported explicitly.

## Anti-patterns

Avoid these unless the product/task genuinely calls for them:

- a dashboard made from a grid of interchangeable rounded cards;
- gradients/glassmorphism used merely to make the UI look modern;
- giant headings that push actual controls below the fold;
- icon-only mystery controls;
- excessive modal/dialog flows;
- tiny secondary text carrying important information;
- low-contrast grey-on-grey styling;
- decorative status dots without labels;
- unnecessary confirmations for reversible actions;
- unnecessary taps to start timers already implied by a physical action;
- animation everywhere;
- hiding functionality on mobile rather than redesigning the layout;
- treating unknown sensor data as zero;
- presenting stale readings as current;
- introducing a new component style for every feature;
- declaring visual success without looking at the rendered UI.

## External design review references

The principles in this skill are informed by established frontend design and review practices, including WCAG 2.2 AA, Anthropic's frontend-design guidance, PracticalSwan's context-fit frontend-design workflow, and Vercel's Web Interface Guidelines. When doing a dedicated design/accessibility audit and web access is available, fetch the latest Vercel Web Interface Guidelines rather than relying on a stale copied checklist.
