# HU07 — Hermes-native presentation specification

## Purpose

Make the Reliquary Hermes integration render as a native Hermes surface instead of maintaining a parallel visual theme.

The immediate defect is visible in the Reliquary setup screen: Reliquary-owned CSS overrides typography, foreground/background colors, borders, inputs and buttons, producing low-contrast labels and controls that do not match the active Hermes theme. The same presentation layer is shared by the web dashboard and Desktop plugin, so the fix must preserve both hosts.

## Overview

HU07 makes Hermes the single owner of fonts, colors and generic controls on both integration surfaces. Reliquary keeps its shared behavior code and plugin-specific structural layout, passes host-native controls through the existing surface boundary, migrates onboarding first, then removes the visual CSS and Desktop theme-translation layer that are no longer needed.

## Problem Statement

Reliquary currently owns too much presentation.

The dashboard bundle renders most controls as raw HTML and `dashboard/styles.css` supplies its own colors, card surfaces, borders, inputs, buttons, focus treatment and muted text. Desktop then adds another translation layer in `desktop/src/plugin.js` that remaps Reliquary CSS variables onto Desktop theme variables.

This duplicates responsibilities already owned by Hermes and creates three concrete costs:

1. Reliquary can drift from Hermes typography, spacing, controls and theme changes.
2. Dark/light theme behavior depends on Reliquary correctly mapping Hermes variables instead of inheriting the host presentation.
3. Shared web/Desktop UI requires presentation compatibility work inside Reliquary whenever either Hermes host changes.

The setup screen exposed the failure clearly: the plugin is functional, but labels and status text become difficult to read and the page does not look like a normal Hermes page.

## Target Architecture

Hermes owns visual presentation. Reliquary owns domain content, interaction logic and plugin-specific layout.

### Host presentation boundary

Keep the existing `ReliquaryDashboardHost` / `createReliquarySurface(...)` boundary. Do not add a second design-system abstraction.

Extend that existing boundary only enough to supply the Hermes-native controls needed by the shared surface.

- Web dashboard entrypoint receives controls from `window.__HERMES_PLUGIN_SDK__.components`.
- Desktop entrypoint receives controls from `@hermes/plugin-sdk`.
- Where the two Hermes SDKs expose the same semantic control with different APIs, normalize that difference once at the host entrypoint. Do not spread `if web / if desktop` branches through the shared Reliquary view modules.
- Shared Reliquary view modules consume the supplied host controls and do not import Hermes packages directly.

The minimum required native control set is the set actually used by the shared surface, expected to include buttons and text inputs immediately and the appropriate Hermes-native select/dialog/textarea primitives where those controls occur.

### Styling ownership

`dashboard/styles.css` becomes structural CSS only.

Reliquary may continue to own:

- page and panel layout;
- grids and responsive breakpoints;
- spacing required to organize Reliquary-specific regions;
- graph canvas geometry, node/edge positioning and overflow;
- dimensions needed for long IDs, paths and provenance text;
- state classes needed for layout or graph interaction where no Hermes primitive exists.

Reliquary must stop owning:

- font family;
- base font color;
- muted-text palette;
- page/card background colors;
- generic borders and radii already supplied by Hermes components;
- generic button appearance;
- generic input/select/textarea appearance;
- generic focus rings;
- dark/light theme translation;
- duplicated `--color-*` aliases that exist only to imitate Hermes.

Text and structural elements without a Hermes component inherit typography and color from the host.

### Desktop

Remove the Reliquary visual-theme mapping currently carried by `paneStyle` in `desktop/src/plugin.js`.

The Desktop plugin may retain only container behavior such as width, height and scrolling. Native controls come from `@hermes/plugin-sdk`; ordinary text inherits the Desktop host.

### Web dashboard

The web bundle must use the controls already exposed by Hermes SDK 1.1.0 rather than styling raw controls to resemble Hermes.

The current external compatibility requirement remains SDK 1.1.0. HU07 does not require a Hermes version bump unless implementation proves a required primitive is absent from that public SDK.

## User / Developer Outcomes

After HU07:

- Reliquary looks like a normal Hermes page in both light and dark themes.
- The setup form no longer contains unreadable dark-on-dark labels or metadata.
- Buttons, inputs, selects and related interactive controls match Hermes automatically.
- Future Hermes theme/font changes flow into Reliquary without plugin CSS changes.
- Reliquary keeps one shared behavior surface without maintaining a parallel design system.
- The setup workflow and all existing authorization/capability behavior remain unchanged.
- Plugin-specific CSS is substantially smaller and has an explicit structural purpose.

## Implementation Decisions

### 1. Use the existing host seam

Do not create a Reliquary component library.

Update the existing host object/options used by the shared dashboard bundle so common view modules can access Hermes-native primitives.

Likely touch points:

- `dashboard/src/live.js`
- `dashboard/scripts/live-bundle.cjs`
- `desktop/src/plugin.js`
- shared dashboard modules that render controls, including `surface.js`, `onboarding.js`, `views.js`, `owner_content.js`, `memory_mutations.js`, and `graph_mutations.js`

The fixture path must supply the same presentation contract through the Hermes web SDK so fixture and live rendering do not diverge.

### 2. Migrate onboarding first

The first migrated surface is `dashboard/src/onboarding.js`, because it contains the current visible defect and exercises the important control types.

Replace Reliquary-styled raw controls with Hermes-native controls for:

- Main REL path;
- Active PHY path;
- optional Reliquary config path;
- project ID/path controls;
- Browse;
- Add/remove project;
- Validate;
- Connect Reliquary.

Preserve all current validation, cancellation, picker, capability-gating and setup behavior.

This ticket is presentation-only. Better explanatory onboarding copy may follow separately; HU07 must not mix a content redesign into the styling migration.

### 3. Migrate the rest of the live surface

After onboarding, replace remaining generic Reliquary-styled controls across the dashboard with host controls.

Examples include:

- session lookup;
- owner selection;
- refresh/retry actions;
- memory mutation forms;
- graph mutation forms;
- paging controls;
- dialogs or destructive confirmations where Hermes already exposes an appropriate primitive.

Do not force a host primitive onto Reliquary-specific graph SVG elements or data visualization geometry.

### 4. Delete visual CSS instead of restyling it

Do not fix the current bug by changing fallback colors or adding more theme variables.

Delete CSS rules whose purpose is to visually recreate a Hermes control or theme.

In particular, the final stylesheet must not retain Reliquary-owned generic rules equivalent to the current:

- `.rly-field input/select/textarea` visual styling;
- `.rly-setup-form button` visual styling;
- generic button border/background/radius rules;
- generic card background/border rules where a Hermes card/panel primitive is used;
- plugin focus-ring styling already supplied by Hermes controls;
- fallback foreground/background palette intended to theme the whole plugin.

Structural class names may remain when they still own layout.

### 5. Remove Desktop theme emulation

Reduce `paneStyle` to container concerns only.

Remove the `--color-foreground`, `--color-muted-foreground`, `--color-background`, `--color-card`, `--color-muted`, `--color-border`, and `--color-primary` translation layer once no surviving structural/graph rule legitimately requires it.

If graph-specific styling still needs host colors, consume public Hermes theme tokens directly at that graph boundary rather than rebuilding a plugin-wide alias palette.

### 6. No behavioral/API changes

HU07 does not change:

- setup DTOs;
- `owners.json` / `provider.json`;
- REL/PHY selection semantics;
- Desktop native-mutation gating;
- dashboard authorization;
- host process behavior;
- source ingestion;
- memory operations;
- Hermes upstream native-admission work.

## Migration Strategy

**Staged hard cut.**

There is no reason to support the old Reliquary visual theme alongside the Hermes-native presentation.

1. Extend the existing host surface with the required native primitives.
2. Convert onboarding and verify setup behavior.
3. Convert remaining generic controls.
4. Remove superseded CSS and Desktop variable translation.
5. Rebuild both dashboard and Desktop artifacts.
6. Run full plugin UI/host acceptance.

Temporary mixed styling is acceptable only inside the implementation branch while controls are being migrated. The merged result must have one presentation owner: Hermes.

No compatibility stylesheet, legacy theme mode or fallback Reliquary skin is permitted.

## Testing Decisions

### Existing seams to preserve

`dashboard/tests/dashboard.test.cjs` already verifies:

- setup candidate validation;
- admitted setup transport;
- Desktop capability gating;
- Browse availability when mutations are blocked;
- Validate/apply behavior;
- shared live-surface isolation;
- plugin SDK registration.

These remain the behavioral seams. Update render fixtures/mocks to include the required native host controls without weakening the assertions.

`desktop/tests/plugin.test.cjs` and existing Desktop smoke coverage remain the Desktop host seam.

The existing Hermes host/browser smoke tests remain the integration seam for the web dashboard.

### New presentation assertions

Add targeted tests that prove ownership moved rather than merely changed colors:

- the live web entry supplies Hermes SDK components to the shared surface;
- the Desktop entry supplies `@hermes/plugin-sdk` native controls;
- onboarding renders host Button/Input/select equivalents rather than relying on raw styled generic controls where a Hermes primitive exists;
- `dashboard/styles.css` contains no plugin-wide font declaration or generic control-theme rules;
- `desktop/src/plugin.js` no longer defines the plugin-wide color-alias map;
- shared behavior still renders under both host adapters.

Do not snapshot entire generated HTML or CSS. Test the ownership boundary and a few representative controls.

### Visual acceptance

Run the installed plugin in the real Hermes dashboard and Desktop host.

Verify at minimum:

- dark theme setup page;
- light theme setup page;
- configured owner/dashboard view;
- disabled Desktop-write capability notice;
- focus/keyboard state on setup controls;
- long REL/PHY paths do not break layout.

Acceptance requires side-by-side consistency with adjacent Hermes controls, not pixel identity between web and Desktop.

## Out of Scope

HU07 does not include:

- rewriting the setup terminology or explanatory copy;
- changing the setup information architecture;
- auto-discovering or auto-selecting REL/PHY files;
- changing project REL behavior;
- redesigning graph visualization;
- changing Hermes itself;
- adding a Reliquary theme or branding system;
- changing the public plugin authorization model.

A separate onboarding-clarity change may simplify the form after HU07 establishes native presentation.

## Completion Gates

HU07 is complete only when all of the following are true:

1. Web Reliquary controls use Hermes web SDK primitives wherever a suitable primitive exists.
2. Desktop Reliquary controls use `@hermes/plugin-sdk` primitives wherever a suitable primitive exists.
3. Shared Reliquary code does not import host-specific Hermes packages directly.
4. Reliquary no longer owns a plugin-wide font, color, background, border, control or focus theme.
5. `dashboard/styles.css` is limited to justified structural/layout/graph styling.
6. Desktop no longer carries the current plugin-wide `--color-*` translation map.
7. Existing setup, mutation, authorization and capability-gating tests remain green.
8. Dashboard and Desktop bundles build cleanly.
9. Installed browser acceptance passes in both Hermes dark and light themes.
10. Installed Desktop acceptance confirms the same functional behavior and native-looking controls.
11. Documentation and verification records are updated to describe Hermes as the presentation owner.
12. `git diff --check` and the repository documentation checker pass.

## Related docs

- [HU05 cross-surface onboarding specification](hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md)
- [HU06 stock Hermes compatibility specification](hu06-stock-hermes-desktop-mutation-compat-spec-2026-11-09.md)
- [Web-dashboard typed DTOs](ui-contract.md)
- [Verification and later gates](verification.md)
- [Local service guide](local-service.md)

## Notes

The current Hermes installations provide the needed native-control surfaces on both hosts: the web dashboard SDK 1.1.0 exposes its component set, and Desktop plugins already consume controls such as `Button`, `Input`, `Select` and dialogs from `@hermes/plugin-sdk`.

The architectural rule established by HU07 is durable: Reliquary may own layout that represents Reliquary concepts, but it must not own a second Hermes visual system.
