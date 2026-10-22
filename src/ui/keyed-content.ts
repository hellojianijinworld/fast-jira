/** 같은 키·표시 내용은 노드와 포커스를 유지하고, 순서·변경된 내용만 반영한다. */
export function keyedContent(host: HTMLElement) {
  let current = new Map<string, HTMLElement>();
  return (entries: readonly (readonly [string, HTMLElement])[]) => {
    const next = new Map<string, HTMLElement>();
    let cursor = host.firstElementChild;
    for (const [key, proposed] of entries) {
      const previous = current.get(key);
      const node =
        previous?.outerHTML === proposed.outerHTML ? previous : proposed;
      if (node !== cursor) host.insertBefore(node, cursor);
      cursor = node.nextElementSibling;
      next.set(key, node);
    }
    for (const [key, node] of current)
      if (next.get(key) !== node) node.remove();
    current = next;
  };
}
