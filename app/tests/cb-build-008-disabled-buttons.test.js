// app/tests/cb-build-008-disabled-buttons.test.js
// CB-BUILD-008: Disabled buttons render a clearly distinct state via fill and weight,
// not opacity alone. R83 interaction contract: a control whose precondition is unmet
// renders clearly disabled (different fill and weight), never presenting as actionable.

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

test('CB-BUILD-008: Disabled button styles use muted fill and no shadow', async (t) => {
  const cssPath = path.join(process.cwd(), 'app/styles/base.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // Find the disabled button rule
  const disabledRuleMatch = cssContent.match(
    /\.cb-btn:disabled[^{]*\{[^}]+\}/s
  );
  assert(
    disabledRuleMatch,
    'Disabled button rule not found'
  );

  const disabledRule = disabledRuleMatch[0];

  // Should NOT use opacity-only cue
  assert(
    !disabledRule.includes('opacity: 0.5'),
    'Disabled button should NOT use opacity: 0.5 as sole cue (R83 violation)'
  );

  // Should have muted fill (not bright yellow #FFE500)
  assert(
    disabledRule.includes('background:') && (
      disabledRule.includes('#5a5a50') || 
      disabledRule.match(/background:\s*[^;]*5a5a50/)
    ),
    'Disabled button should use muted/desaturated background fill (not bright yellow)'
  );

  // Should have no drop-shadow
  assert(
    !disabledRule.includes('box-shadow: 3px 3px'),
    'Disabled button should NOT have drop-shadow'
  );

  assert(
    disabledRule.includes('box-shadow: none') || !disabledRule.includes('box-shadow'),
    'Disabled button should have no shadow (box-shadow: none)'
  );

  // Should keep cursor: not-allowed
  assert(
    disabledRule.includes('cursor: not-allowed'),
    'Disabled button should keep cursor: not-allowed'
  );
});

test('CB-BUILD-008: Active button retains its appearance (visual distinction from disabled)', async (t) => {
  const cssPath = path.join(process.cwd(), 'app/styles/base.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // Find the active button rule
  const activeRuleMatch = cssContent.match(
    /\.cb-btn:active[^{]*\{[^}]+\}/s
  );
  assert(
    activeRuleMatch,
    'Active button rule not found'
  );

  const activeRule = activeRuleMatch[0];

  // Active buttons should still have their transform effect
  assert(
    activeRule.includes('transform: translate(2px, 2px)'),
    'Active button should have translate transform'
  );

  // Active buttons should have reduced shadow (not full 3px 3px)
  assert(
    activeRule.includes('box-shadow: 0 0 0') || activeRule.includes('box-shadow: none'),
    'Active button should have reduced shadow effect'
  );
});

test('CB-BUILD-008: Normal (active/enabled) buttons retain full styling', async (t) => {
  const cssPath = path.join(process.cwd(), 'app/styles/base.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // Find the base button rule (before :disabled/:active)
  const baseRuleMatch = cssContent.match(
    /^\.cb-btn\s*\{[^}]+\}/m
  );
  assert(
    baseRuleMatch,
    'Base button rule not found'
  );

  const baseRule = baseRuleMatch[0];

  // Should have bright yellow background
  assert(
    baseRule.includes('background: var(--cb-yellow)'),
    'Normal button should have bright yellow background'
  );

  // Should have black text
  assert(
    baseRule.includes('color: var(--cb-black)'),
    'Normal button should have black text'
  );

  // Should have full 3x3 drop-shadow
  assert(
    baseRule.includes('box-shadow: 3px 3px 0 var(--cb-black)'),
    'Normal button should have full 3x3 drop-shadow'
  );

  // Should have not-allowed cursor only when disabled
  assert(
    !baseRule.includes('cursor: not-allowed'),
    'Normal button should not have not-allowed cursor (only when disabled)'
  );
});

test('CB-BUILD-008: Gate wiring (aria-disabled) is untouched; only styling changed', async (t) => {
  // Verify that the git diff only touches CSS, not gate logic
  const screenFiles = [
    'app/ui/screens/duel.js',
    'app/ui/screens/screener.js',
    'app/ui/screens/sitting.js',
  ];

  let foundAriaDisabledGuarding = false;

  for (const file of screenFiles) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check that aria-disabled is still gating logic
    if (content.includes('aria-disabled') && content.includes('if (!') ) {
      foundAriaDisabledGuarding = true;
      break;
    }
  }

  // This test verifies the gate logic (onClick guard + aria-disabled) is unchanged
  // by checking that the files still have both. A visual test of the button would
  // require a browser; this confirms we didn't accidentally touch the gates.
  // CB-BUILD-fix-round-1 (advisory): this used to be an `assert(true)`
  // placeholder that could never fail — it now asserts the computed sweep.
  assert(
    foundAriaDisabledGuarding,
    'Gate wiring should be unchanged (aria-disabled + guard logic in onClick)'
  );
});

// ---- CB-BUILD-fix-round-1 #1: the disabled treatment must WIN the cascade ----
// The review's reproduction: `.cb-btn.secondary` (equal specificity, loads
// LATER in base.css) re-asserted `background: transparent; color: offwhite`
// over the muted disabled fill — a disabled secondary button was
// pixel-identical to an enabled one (live at lobby-entry.js's below-floor
// "Find a Bracket", sitting.js's spectate button); `.cb-btn.win`/`.danger`
// overrode the same way, and the money sheets' Continue carried an INLINE
// background that beat every stylesheet rule. These are cascade-order/
// specificity assertions on the actual shipped stylesheets — not mere rule
// presence.

// A minimal CSS specificity calculator (classes + attributes + pseudo-classes
// all weigh at the "class" level; no ids/elements are used by these selectors).
function specificityOf(selector) {
  const s = selector.trim();
  const classes = (s.match(/\.[a-zA-Z0-9_-]+/g) || []).length;
  const attrs = (s.match(/\[[^\]]+\]/g) || []).length;
  const pseudos = (s.match(/:(?!:)[a-zA-Z-]+/g) || []).length;
  return classes + attrs + pseudos;
}

function parseCssRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    rules.push({ selector: m[1].trim(), body: m[2], index: rules.length });
  }
  return rules;
}

test('CB-BUILD-fix-round-1 #1: for EVERY .cb-btn variant, a muted-fill disabled rule wins the cascade (higher specificity, or equal specificity and later in source)', async (t) => {
  const cssContent = fs.readFileSync(path.join(process.cwd(), 'app/styles/base.css'), 'utf-8');
  const rules = parseCssRules(cssContent);

  const variants = ['secondary', 'danger', 'win', 'block', 'deposit'];
  for (const variant of variants) {
    // The variant's own (enabled) skin rule, if it declares a background.
    const variantRules = rules
      .map((r) => ({ ...r, sel: r.selector.split(',').map((x) => x.trim()).find((x) => x === `.cb-btn.${variant}`) }))
      .filter((r) => r.sel && /background\s*:/.test(r.body));

    // Every rule whose selector list includes a disabled state FOR this
    // variant and declares the muted fill.
    const disabledRules = rules
      .map((r) => ({
        ...r,
        sel: r.selector.split(',').map((x) => x.trim()).find(
          (x) => x === `.cb-btn.${variant}:disabled` || x === `.cb-btn.${variant}[aria-disabled="true"]`
        ),
      }))
      .filter((r) => r.sel && r.body.includes('#5a5a50') && /box-shadow\s*:\s*none/.test(r.body));

    assert(
      disabledRules.length > 0,
      `.cb-btn.${variant}: no variant-qualified disabled rule with the muted fill (#5a5a50) + box-shadow:none found in base.css`
    );

    // Cascade check: for each enabled skin rule that sets a background, at
    // least one disabled rule must WIN over it — strictly higher specificity,
    // or equal specificity AND later in source order.
    for (const vr of variantRules) {
      const winner = disabledRules.some((dr) => {
        const dSpec = specificityOf(dr.sel);
        const vSpec = specificityOf(vr.sel);
        return dSpec > vSpec || (dSpec === vSpec && dr.index > vr.index);
      });
      assert(
        winner,
        `.cb-btn.${variant}: the disabled rule does not win the cascade over "${vr.sel}" (specificity/order)`
      );
    }
  }
});

test('CB-BUILD-fix-round-1 #1: the money sheets\' Continue no longer carries an inline background style (inline styles beat every stylesheet rule, including the disabled one)', async (t) => {
  const src = fs.readFileSync(path.join(process.cwd(), 'app/ui/components/money-sheets.js'), 'utf-8');
  assert(
    !/style:\s*'[^']*background\s*:/.test(src),
    'money-sheets.js must not skin a button via an inline background style — use a .cb-btn class variant so the disabled cascade can win'
  );
  assert(
    src.includes("class: 'cb-btn block deposit'"),
    'expected the Continue button to use the .cb-btn.deposit class variant'
  );
  const cssContent = fs.readFileSync(path.join(process.cwd(), 'app/styles/base.css'), 'utf-8');
  assert(
    /\.cb-btn\.deposit\s*\{[^}]*background:\s*#2563eb/s.test(cssContent),
    'expected the .cb-btn.deposit skin (same colors as the old inline style) in base.css'
  );
});

test('CB-BUILD-fix-round-1 #1: the live disabled-state sites (lobby-entry, sitting, duel seal) still gate via disabled/aria-disabled so the CSS state applies', async (t) => {
  const lobbySrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/screens/lobby-entry.js'), 'utf-8');
  assert(/['"]aria-disabled['"]:\s*!meetsFloor/.test(lobbySrc), 'lobby-entry: the below-floor Find a Bracket button must set aria-disabled');
  const sittingSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/screens/sitting.js'), 'utf-8');
  assert(/['"]aria-disabled['"]:\s*(reenterSubmitting|submitting)/.test(sittingSrc), 'sitting: submitting buttons must set aria-disabled');
  const duelSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/screens/duel.js'), 'utf-8');
  assert(duelSrc.includes("'aria-disabled': isSealDisabled(moves)"), 'duel: the seal button must set aria-disabled');
});

test('CB-BUILD-008: Visual distinction is clear: fill and weight change, not just opacity', async (t) => {
  const cssPath = path.join(process.cwd(), 'app/styles/base.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // Extract both rules for comparison
  const baseRuleMatch = cssContent.match(/^\.cb-btn\s*\{[^}]+\}/ms);
  const disabledRuleMatch = cssContent.match(/\.cb-btn:disabled[^{]*\{[^}]+\}/s);

  assert(baseRuleMatch && disabledRuleMatch, 'Both rules needed for comparison');

  const baseRule = baseRuleMatch[0];
  const disabledRule = disabledRuleMatch[0];

  // Extract background colors
  const baseBackground = baseRule.match(/background:\s*([^;]+)/)?.[1];
  const disabledBackground = disabledRule.match(/background:\s*([^;]+)/)?.[1];

  // Should be different
  assert(
    baseBackground !== disabledBackground,
    `Fill must change: enabled="${baseBackground}" should differ from disabled="${disabledBackground}"`
  );

  // Extract shadows
  const baseShadow = baseRule.match(/box-shadow:\s*([^;]+)/)?.[1];
  const disabledShadow = disabledRule.match(/box-shadow:\s*([^;]+)/)?.[1];

  // Shadow weight should change
  assert(
    baseShadow !== disabledShadow,
    `Weight (shadow) must change: enabled="${baseShadow}" should differ from disabled="${disabledShadow}"`
  );
});
