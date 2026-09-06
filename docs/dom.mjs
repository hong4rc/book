/**
 * Shared DOM helpers.
 *
 * Extracted because `el()` was duplicated in app.mjs and book.mjs, and because
 * the duplication hid a real bug: `Node.append()` accepts nodes and strings and
 * **coerces everything else to a string**, so passing a conditional child that
 * evaluates to `null` appends a text node reading `null`.
 *
 *   parent.append(<p>, null, <span>)  =>  "<p></p>null<span></span>"
 *
 * That shipped: a conditional child was null for 6,474 of 6,482 books, so
 * nearly every book detail panel rendered a stray "null". Use `appendAll` for
 * anything that can be conditional; never call `.append()` directly with an
 * expression that might be nullish.
 */

/**
 * Append children, skipping nullish ones.
 *
 * Filters on `== null` rather than falsiness: `0` and `''` are legitimate
 * content and must still render.
 */
export function appendAll(parent, ...children) {
  for (const child of children.flat()) {
    if (child != null) parent.append(child)
  }
  return parent
}

/** Create an element from props, appending any non-nullish children. */
export function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props)
  return appendAll(node, ...[].concat(children))
}
