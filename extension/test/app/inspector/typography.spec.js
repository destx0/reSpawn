import {
  hasDirectRenderableText,
  TypographyInspector,
} from '../../../src/inspector/typography.js';

const createInspector = () => new TypographyInspector(document, window);

describe('typography', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.head.querySelectorAll('style').forEach((style) => style.remove());
  });

  it('only accepts elements with their own non-empty text', () => {
    const direct = document.createElement('p');
    direct.textContent = 'Hello';

    const nested = document.createElement('div');
    const child = document.createElement('span');
    child.textContent = 'Hello';
    nested.append(child);

    const blank = document.createElement('p');
    blank.textContent = '   ';

    expect(hasDirectRenderableText(direct)).toBe(true);
    expect(hasDirectRenderableText(nested)).toBe(false);
    expect(hasDirectRenderableText(blank)).toBe(false);
  });

  it('reads family, size, weight, line height and tracking', () => {
    const element = document.createElement('p');
    element.textContent = 'Hello';
    element.style.fontFamily = '"Inter", sans-serif';
    element.style.fontSize = '16px';
    element.style.fontWeight = '600';
    element.style.lineHeight = '24px';
    element.style.letterSpacing = '0.5px';
    document.body.append(element);

    const info = createInspector().getFast(element);

    expect(info.rows.map((row) => row.label)).toEqual([
      'Family',
      'Size',
      'Weight',
      'Line height',
      'Tracking',
    ]);
    expect(info.rows.map((row) => row.value)).toEqual([
      'Inter',
      '16px',
      '600',
      '24px',
      '0.5px',
    ]);
    expect(info.tagName).toBe('p');
    expect(info.textSnippet).toBe('Hello');
  });

  it('resolves the custom property that drives a value', () => {
    const style = document.createElement('style');
    style.textContent = '.heading { font-family: var(--font-heading); }';
    document.head.append(style);

    const element = document.createElement('h2');
    element.className = 'heading';
    element.textContent = 'Hello';
    element.style.fontSize = '20px';
    document.body.append(element);

    const family = createInspector()
      .getFull(element)
      .rows.find((row) => row.label === 'Family');

    expect(family?.varName).toBe('--font-heading');
  });

  it('prefers the more specific rule when several set the property', () => {
    const style = document.createElement('style');
    style.textContent =
      'h2 { font-size: var(--size-alt); } .heading { font-size: var(--size-base); }';
    document.head.append(style);

    const element = document.createElement('h2');
    element.className = 'heading';
    element.textContent = 'Hello';
    document.body.append(element);

    const size = createInspector()
      .getFull(element)
      .rows.find((row) => row.label === 'Size');

    expect(size?.varName).toBe('--size-base');
  });

  it('picks up stylesheets added after the first read', () => {
    const element = document.createElement('h2');
    element.className = 'heading';
    element.textContent = 'Hello';
    document.body.append(element);

    const inspector = createInspector();
    expect(
      inspector
        .getFull(element)
        .rows.find((row) => row.label === 'Size')?.varName,
    ).toBeNull();

    const style = document.createElement('style');
    style.textContent = '.heading { font-size: var(--size-base); }';
    document.head.append(style);

    expect(
      inspector
        .getFull(element)
        .rows.find((row) => row.label === 'Size')?.varName,
    ).toBe('--size-base');
  });
});
