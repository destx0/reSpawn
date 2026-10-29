// Computed typography for the hover inspector. Ported from Mesurer's
// `runtime/text-inspector-typography.ts` (MIT) and trimmed to the five values
// the card shows. Values come from `getComputedStyle`; the CSS custom property
// that drives each value is resolved separately from the page's stylesheets,
// because computed styles lose the `var()` reference.

const TYPO_ROWS = [
  { label: 'Family', property: 'font-family' },
  { label: 'Size', property: 'font-size' },
  { label: 'Weight', property: 'font-weight' },
  { label: 'Line height', property: 'line-height' },
  { label: 'Tracking', property: 'letter-spacing' },
] as const;

type TypoProperty = (typeof TYPO_ROWS)[number]['property'];

const TYPO_PROPERTIES: readonly TypoProperty[] = TYPO_ROWS.map(
  (row) => row.property,
);

const PROPERTY_BY_LABEL = new Map<string, TypoProperty>(
  TYPO_ROWS.map((row) => [row.label, row.property]),
);

export type TypographyRow = {
  readonly label: string;
  readonly value: string;
  readonly varName: string | null;
};

export type TypographyInfo = {
  readonly rows: readonly TypographyRow[];
  readonly tagName: string;
  readonly textSnippet: string;
};

type FlatRule = { rule: CSSStyleRule; mediaOk: boolean; order: number };
type Candidate = {
  name: string | null;
  specificity: number;
  order: number;
  important: boolean;
};

const formatPx = (raw: string) => {
  if (!raw || raw === 'normal') return raw || 'normal';
  const match = /^(-?[\d.]+)px$/.exec(raw);
  if (!match) return raw;
  return `${Math.round(Number(match[1]) * 10) / 10}px`;
};

const firstFontFamily = (families: string) =>
  (families.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '');

const extractVarName = (value: string | null | undefined) => {
  if (!value) return null;
  return /var\(\s*(--[a-zA-Z0-9_-]+)/.exec(value)?.[1] ?? null;
};

const selectorSpecificity = (selector: string) => {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? []).length;
  const elements = (selector.match(/(?:^|[ >+~])([a-zA-Z][\w-]*)/g) ?? [])
    .length;
  return ids * 10000 + classes * 100 + elements;
};

const wins = (next: Candidate, previous: Candidate | undefined) => {
  if (!previous) return true;
  if (next.important !== previous.important) return next.important;
  if (next.specificity !== previous.specificity) {
    return next.specificity > previous.specificity;
  }
  return next.order > previous.order;
};

/** True when the element itself owns a non-empty text node. */
export const hasDirectRenderableText = (element: Element) =>
  Array.from(element.childNodes).some(
    (node) => node.nodeType === 3 && Boolean(node.nodeValue?.trim()),
  );

export class TypographyInspector {
  private rulesCache: FlatRule[] | null = null;
  private rulesSignature = '';

  constructor(
    private readonly document: Document,
    private readonly window: Window,
  ) {}

  invalidate() {
    this.rulesCache = null;
    this.rulesSignature = '';
  }

  private collectRules(
    rules: CSSRuleList,
    output: FlatRule[],
    mediaOk: boolean,
    order: { value: number },
  ) {
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index];
      const currentOrder = order.value++;
      if (rule.type === 4) {
        const mediaRule = rule as CSSMediaRule;
        let matches = mediaOk;
        try {
          matches =
            mediaOk &&
            this.window.matchMedia(mediaRule.media.mediaText).matches;
        } catch {
          matches = false;
        }
        this.collectRules(mediaRule.cssRules, output, matches, order);
      } else if (rule.type === 12) {
        this.collectRules(
          (rule as CSSSupportsRule).cssRules,
          output,
          mediaOk,
          order,
        );
      } else if (rule.type === 1) {
        output.push({
          rule: rule as CSSStyleRule,
          mediaOk,
          order: currentOrder,
        });
      } else if ('cssRules' in rule) {
        this.collectRules(
          (rule as CSSGroupingRule).cssRules,
          output,
          mediaOk,
          order,
        );
      }
    }
  }

  private getRules() {
    const sheets = Array.from(this.document.styleSheets);
    // A cheap signature catches stylesheets that load or change while the
    // mode is open; a cached rule list would otherwise miss their variables.
    const signature = sheets
      .map((sheet) => {
        try {
          return sheet.cssRules.length;
        } catch {
          return -1;
        }
      })
      .join(',');
    if (this.rulesCache && signature === this.rulesSignature) {
      return this.rulesCache;
    }
    const rules: FlatRule[] = [];
    const order = { value: 0 };
    for (const sheet of sheets) {
      try {
        this.collectRules(sheet.cssRules, rules, true, order);
      } catch {
        // Cross-origin sheets throw on `cssRules`; skip them.
      }
    }
    this.rulesCache = rules;
    this.rulesSignature = signature;
    return rules;
  }

  private findVarReferences(
    el: HTMLElement,
  ): Record<TypoProperty, string | null> {
    const result = Object.fromEntries(
      TYPO_PROPERTIES.map((property) => [property, null]),
    ) as Record<TypoProperty, string | null>;
    const rules = this.getRules().filter((entry) => {
      if (!entry.mediaOk) return false;
      return TYPO_PROPERTIES.some((property) =>
        entry.rule.style.getPropertyValue(property),
      );
    });

    for (const property of TYPO_PROPERTIES) {
      let node: HTMLElement | null = el;
      while (node && result[property] === null) {
        let winner: Candidate | undefined;
        const inlineValue = node.style.getPropertyValue(property);
        if (inlineValue) {
          winner = {
            name: extractVarName(inlineValue),
            specificity: Number.MAX_SAFE_INTEGER,
            order: Number.MAX_SAFE_INTEGER,
            important: node.style.getPropertyPriority(property) === 'important',
          };
        }

        for (const { rule, order } of rules) {
          let matches = false;
          try {
            matches = node.matches(rule.selectorText);
          } catch {
            continue;
          }
          if (!matches) continue;
          const value = rule.style.getPropertyValue(property);
          if (!value) continue;
          const candidate = {
            name: extractVarName(value),
            specificity: selectorSpecificity(rule.selectorText),
            order,
            important: rule.style.getPropertyPriority(property) === 'important',
          };
          if (wins(candidate, winner)) winner = candidate;
        }

        if (winner) {
          if (winner.name) result[property] = winner.name;
          break;
        }
        node = node.parentElement;
      }
    }
    return result;
  }

  getFast(el: HTMLElement): TypographyInfo {
    const styles = this.window.getComputedStyle(el);
    const values: Record<TypoProperty, string> = {
      'font-family': firstFontFamily(styles.fontFamily),
      'font-size': formatPx(styles.fontSize),
      'font-weight': styles.fontWeight || 'normal',
      'line-height':
        styles.lineHeight === 'normal' ? 'normal' : formatPx(styles.lineHeight),
      'letter-spacing':
        styles.letterSpacing === 'normal'
          ? 'normal'
          : formatPx(styles.letterSpacing),
    };
    const directText = Array.from(el.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.nodeValue?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ');

    return {
      rows: TYPO_ROWS.map(({ label, property }) => ({
        label,
        value: values[property],
        varName: null,
      })),
      tagName: el.tagName.toLowerCase(),
      textSnippet:
        directText.length > 40 ? `${directText.slice(0, 40)}…` : directText,
    };
  }

  getFull(el: HTMLElement, base = this.getFast(el)): TypographyInfo {
    const vars = this.findVarReferences(el);
    return {
      ...base,
      rows: base.rows.map((row) => ({
        ...row,
        varName: vars[PROPERTY_BY_LABEL.get(row.label) ?? 'font-family'],
      })),
    };
  }
}
