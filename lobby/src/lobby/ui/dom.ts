/** Tiny DOM helpers — the UI overlays are plain DOM (framework-agnostic). */

interface ElProps {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  ariaLabel?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  maxLength?: number;
  role?: string;
  style?: Partial<CSSStyleDeclaration>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.title) node.title = props.title;
  if (props.ariaLabel) node.setAttribute('aria-label', props.ariaLabel);
  if (props.role) node.setAttribute('role', props.role);
  if (props.type && 'type' in node) (node as HTMLInputElement).type = props.type;
  if (props.value !== undefined && 'value' in node) (node as HTMLInputElement).value = props.value;
  if (props.placeholder && 'placeholder' in node)
    (node as HTMLInputElement).placeholder = props.placeholder;
  if (props.maxLength !== undefined && 'maxLength' in node)
    (node as HTMLInputElement).maxLength = props.maxLength;
  if (props.style) Object.assign(node.style, props.style);
  for (const c of children) node.append(c);
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
