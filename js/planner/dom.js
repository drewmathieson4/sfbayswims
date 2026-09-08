// User-provided names always enter the document as text.
export function span(parent, className, text) {
  const child = document.createElement('span');
  child.className = className; child.textContent = text; parent.appendChild(child);
  return child;
}
